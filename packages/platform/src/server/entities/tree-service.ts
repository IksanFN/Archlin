import { ownerOf, sqlFor } from '@archlin/db/scoped';
import { ConflictError, NotFoundError, ValidationError } from '@archlin/kernel';
import type { Clock, EventPublisher, Ids, ModuleRegistry, ReadTx, WriteTx } from '@archlin/kernel';
import { generateKeyBetween } from 'fractional-indexing';
import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import { MAX_TREE_DEPTH, TRASH_RETENTION_DAYS } from '../../contracts';
import type {
  Breadcrumb,
  EntityRef,
  MoveEntityInput,
  Placement,
  RecentEntity,
  RestoreOutcome,
  TrashRoot,
  TreeNode,
} from '../../contracts';
import { entityCreated, entityDeleted, entityMoved, entityRestored, entityUpdated } from './events';
import { lockOwnerTree } from './lock';
import type { EntitiesDatabase, EntitiesTable, SpacesTable } from './schema';

export interface EntityRecord {
  id: string;
  kind: string;
  spaceId: string;
  parentId: string | null;
  position: string;
  title: string;
  icon: string | null;
  isStarred: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface TreeService {
  create(
    tx: WriteTx,
    input: {
      kind: string;
      spaceId: string;
      parentId: string | null;
      title: string;
      icon: string | null;
      placement: Placement;
    },
  ): Promise<EntityRecord>;
  get(tx: ReadTx, entityId: string): Promise<EntityRecord>;
  children(tx: ReadTx, input: { spaceId: string; parentId: string | null }): Promise<TreeNode[]>;
  ancestors(tx: ReadTx, entityId: string): Promise<Breadcrumb[]>;
  move(tx: WriteTx, input: MoveEntityInput): Promise<EntityRecord>;
  trash(tx: WriteTx, entityId: string): Promise<{ rootId: string; count: number }>;
  restore(tx: WriteTx, rootId: string): Promise<RestoreOutcome>;
  purge(tx: WriteTx, rootId: string): Promise<{ count: number }>;
  emptyTrash(tx: WriteTx): Promise<{ roots: number; count: number }>;
  purgeExpired(tx: WriteTx): Promise<{ roots: number; count: number }>;
  trashRoots(tx: ReadTx): Promise<TrashRoot[]>;
  setTitle(tx: WriteTx, entityId: string, title: string): Promise<EntityRecord>;
  setIcon(tx: WriteTx, entityId: string, icon: string | null): Promise<EntityRecord>;
  setStarred(tx: WriteTx, entityId: string, starred: boolean): Promise<EntityRecord>;
  touch(tx: WriteTx, entityId: string, fields: readonly string[], changes?: { title?: string }): Promise<EntityRecord>;
  recordView(tx: WriteTx, entityId: string): Promise<void>;
  starred(tx: ReadTx): Promise<EntityRef[]>;
  recentInSpace(tx: ReadTx, spaceId: string, limit: number): Promise<RecentEntity[]>;
  subtreeCounts(tx: ReadTx, entityIds: readonly string[]): Promise<Map<string, number>>;
}

type EntityRow = Selectable<EntitiesTable>;
type SpaceRow = Selectable<SpacesTable>;
type Sibling = { id: string; position: string };

const RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const unknownKind = () => new ValidationError('unknown_kind', 'Jenis tidak dikenali');
const entityNotFound = () => new NotFoundError('entity_not_found', 'Entitas tidak ditemukan');
const trashItemNotFound = () => new NotFoundError('trash_item_not_found', 'Item sampah tidak ditemukan');
const entityInTrash = () => new ConflictError('entity_in_trash', 'Entitas ada di sampah');
const spaceArchived = () => new ValidationError('space_archived', 'Space diarsipkan');
const spaceNotFound = () => new NotFoundError('space_not_found', 'Space tidak ditemukan');
const invalidParent = () => new ValidationError('invalid_parent', 'Induk tidak valid');
const treeCycle = () => new ValidationError('tree_cycle', 'Pemindahan membentuk siklus');
const treeTooDeep = () => new ValidationError('tree_too_deep', 'Tree terlalu dalam');
const parentInTrash = () => new ConflictError('parent_in_trash', 'Halaman induknya ada di Trash');
const invalidSibling = () => new ValidationError('invalid_sibling', 'Saudara tidak valid');
const titleTooLong = () => new ValidationError('title_too_long', 'Judul terlalu panjang');

function dbOf(tx: ReadTx) {
  return sqlFor<EntitiesDatabase>(tx);
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

function toRecord(row: EntityRow): EntityRecord {
  return {
    id: row.id,
    kind: row.kind,
    spaceId: row.space_id,
    parentId: row.parent_id,
    position: row.position,
    title: row.title,
    icon: row.icon,
    isStarred: row.is_starred,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function requireTitle(title: string): string {
  const normalized = normalizeTitle(title);
  if (normalized.length > 500) throw titleTooLong();
  return normalized;
}

function placementKey(siblings: readonly Sibling[], placement: Placement): string {
  if (typeof placement === 'object') return moveKey(siblings, null, placement.afterId);
  if (placement === 'first') return generateKeyBetween(null, siblings[0]?.position ?? null);
  const last = siblings[siblings.length - 1];
  return generateKeyBetween(last?.position ?? null, null);
}

function moveKey(siblings: readonly Sibling[], beforeId: string | null, afterId: string | null): string {
  if (afterId !== null) {
    const afterIndex = siblings.findIndex((row) => row.id === afterId);
    const after = siblings[afterIndex];
    if (afterIndex < 0 || after === undefined) throw invalidSibling();
    return generateKeyBetween(after.position, siblings[afterIndex + 1]?.position ?? null);
  }
  if (beforeId !== null) {
    const beforeIndex = siblings.findIndex((row) => row.id === beforeId);
    const before = siblings[beforeIndex];
    if (beforeIndex < 0 || before === undefined) throw invalidSibling();
    return generateKeyBetween(siblings[beforeIndex - 1]?.position ?? null, before.position);
  }
  const last = siblings[siblings.length - 1];
  return generateKeyBetween(last?.position ?? null, null);
}

export function createTreeService(deps: {
  registry: ModuleRegistry;
  publisher: EventPublisher;
  clock: Clock;
  ids: Ids;
}): TreeService {
  const { registry, publisher, clock, ids } = deps;

  function requireTreeable(kind: string): void {
    if (registry.entityKind(kind)?.treeable !== true) throw unknownKind();
  }

  // Non-treeable children (attachments) stay out of every tree listing and out of depth arithmetic.
  const isTreeable = (column: string) => sql<boolean>`${sql.ref(column)} = any(${registry.treeableKinds}::text[])`;

  async function loadEntity(tx: ReadTx, entityId: string): Promise<EntityRow> {
    const row = await dbOf(tx).selectFrom('entities').selectAll().where('id', '=', entityId).executeTakeFirst();
    if (!row) throw entityNotFound();
    return row;
  }

  function requireAlive(row: EntityRow): void {
    if (row.deleted_at !== null) throw entityInTrash();
  }

  async function loadSpace(tx: ReadTx, spaceId: string): Promise<SpaceRow> {
    const row = await dbOf(tx).selectFrom('spaces').selectAll().where('id', '=', spaceId).executeTakeFirst();
    if (!row) throw spaceNotFound();
    return row;
  }

  async function loadTrashRoot(tx: ReadTx, rootId: string): Promise<EntityRow> {
    const row = await dbOf(tx).selectFrom('entities').selectAll().where('id', '=', rootId).executeTakeFirst();
    if (!row || row.deleted_at === null || row.deleted_root_id !== row.id) throw trashItemNotFound();
    return row;
  }

  async function requireParent(tx: ReadTx, parentId: string, spaceId: string): Promise<EntityRow> {
    const parent = await dbOf(tx).selectFrom('entities').selectAll().where('id', '=', parentId).executeTakeFirst();
    if (!parent || parent.deleted_at !== null || parent.space_id !== spaceId) throw invalidParent();
    if (registry.entityKind(parent.kind)?.treeable !== true) throw invalidParent();
    return parent;
  }

  async function aliveSiblings(
    tx: ReadTx,
    spaceId: string,
    parentId: string | null,
    excludeId?: string,
  ): Promise<Sibling[]> {
    let query = dbOf(tx)
      .selectFrom('entities')
      .select(['id', 'position'])
      .where('space_id', '=', spaceId)
      .where('deleted_at', 'is', null)
      .orderBy('position');
    query = parentId === null ? query.where('parent_id', 'is', null) : query.where('parent_id', '=', parentId);
    if (excludeId !== undefined) query = query.where('id', '!=', excludeId);
    return query.execute();
  }

  // Level of a node: space root is 1, each child is one more. Walks toward the root.
  async function nodeLevel(tx: ReadTx, entityId: string): Promise<number> {
    const { rows } = await sql<{ level: number }>`
      with recursive walk as (
        select id, parent_id, 1 as level
        from entities
        where id = ${entityId}
        union all
        select e.id, e.parent_id, w.level + 1
        from entities e
        inner join walk w on e.id = w.parent_id
        where w.level < ${MAX_TREE_DEPTH + 8}
      )
      select coalesce(max(level), 0)::int as level from walk
    `.execute(dbOf(tx));
    return rows[0]?.level ?? 0;
  }

  async function liveHeight(tx: ReadTx, entityId: string): Promise<number> {
    const { rows } = await sql<{ height: number }>`
      with recursive tree as (
        select id, 1 as depth
        from entities
        where id = ${entityId} and deleted_at is null
        union all
        select e.id, t.depth + 1
        from entities e
        inner join tree t on e.parent_id = t.id
        where e.deleted_at is null and ${isTreeable('e.kind')} and t.depth < ${MAX_TREE_DEPTH + 8}
      )
      select coalesce(max(depth), 0)::int as height from tree
    `.execute(dbOf(tx));
    return rows[0]?.height ?? 0;
  }

  // Height of the trashed operation rooted at rootId, counted over its own rows only.
  async function trashedHeight(tx: ReadTx, rootId: string): Promise<number> {
    const { rows } = await sql<{ height: number }>`
      with recursive tree as (
        select id, 1 as depth
        from entities
        where id = ${rootId}
        union all
        select e.id, t.depth + 1
        from entities e
        inner join tree t on e.parent_id = t.id
        where e.deleted_root_id = ${rootId} and ${isTreeable('e.kind')} and t.depth < ${MAX_TREE_DEPTH + 8}
      )
      select coalesce(max(depth), 0)::int as height from tree
    `.execute(dbOf(tx));
    return rows[0]?.height ?? 0;
  }

  async function wouldCycle(tx: ReadTx, entityId: string, newParentId: string): Promise<boolean> {
    const { rows } = await sql<{ found: number }>`
      with recursive walk as (
        select id, parent_id, 1 as depth
        from entities
        where id = ${newParentId}
        union all
        select e.id, e.parent_id, w.depth + 1
        from entities e
        inner join walk w on e.id = w.parent_id
        where w.depth < ${MAX_TREE_DEPTH + 8}
      )
      select 1::int as found from walk where id = ${entityId} limit 1
    `.execute(dbOf(tx));
    return rows.length > 0;
  }

  async function mutateAlive(
    tx: WriteTx,
    entityId: string,
    fields: readonly string[],
    patch: { title?: string; icon?: string | null; is_starred?: boolean },
  ): Promise<EntityRecord> {
    const current = await loadEntity(tx, entityId);
    requireAlive(current);
    const now = clock.now();
    const row = await dbOf(tx)
      .updateTable('entities')
      .set({ ...patch, revision: sql`revision + 1`, updated_at: now })
      .where('id', '=', entityId)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw entityNotFound();
    await publisher.publish(
      {
        definition: entityUpdated,
        aggregateId: row.id,
        aggregateRevision: row.revision,
        payload: { kind: row.kind, fields: [...fields] },
      },
      tx,
    );
    return toRecord(row);
  }

  async function touchEntity(
    tx: WriteTx,
    entityId: string,
    fields: readonly string[],
    changes?: { title?: string },
  ): Promise<EntityRecord> {
    if (changes?.title !== undefined && !fields.includes('title')) {
      throw new Error('touch with a title change requires "title" in fields');
    }
    const patch: { title?: string } = {};
    if (changes?.title !== undefined) patch.title = requireTitle(changes.title);
    return mutateAlive(tx, entityId, fields, patch);
  }

  async function deleteTrashRoots(tx: WriteTx, cutoff: Date | null): Promise<{ roots: number; count: number }> {
    const result =
      cutoff === null
        ? await sql<{ roots: number; count: number }>`
            with roots as (
              select id from entities where deleted_at is not null and id = deleted_root_id
            ),
            deleted as (
              delete from entities where deleted_at is not null returning id
            )
            select
              (select count(*)::int from roots) as roots,
              (select count(*)::int from deleted) as count
          `.execute(dbOf(tx))
        : await sql<{ roots: number; count: number }>`
            with expired as (
              select id from entities
              where deleted_at is not null and id = deleted_root_id and deleted_at <= ${cutoff}
            ),
            deleted as (
              delete from entities where deleted_root_id in (select id from expired) returning id
            )
            select
              (select count(*)::int from expired) as roots,
              (select count(*)::int from deleted) as count
          `.execute(dbOf(tx));
    return result.rows[0] ?? { roots: 0, count: 0 };
  }

  return {
    async create(tx, input) {
      await lockOwnerTree(tx);
      const definition = registry.entityKind(input.kind);
      if (definition === undefined) throw unknownKind();
      const space = await loadSpace(tx, input.spaceId);
      if (space.archived_at !== null) throw spaceArchived();
      const title = requireTitle(input.title);
      if (input.parentId !== null) {
        const parent = await requireParent(tx, input.parentId, input.spaceId);
        if (definition.treeable && (await nodeLevel(tx, parent.id)) + 1 > MAX_TREE_DEPTH) throw treeTooDeep();
      } else if (!definition.treeable) {
        throw invalidParent();
      }
      const siblings = await aliveSiblings(tx, input.spaceId, input.parentId);
      const now = clock.now();
      const row = await dbOf(tx)
        .insertInto('entities')
        .values({
          id: ids.uuidv7(),
          owner_id: ownerOf(tx),
          kind: input.kind,
          space_id: input.spaceId,
          parent_id: input.parentId,
          position: placementKey(siblings, input.placement),
          title,
          icon: input.icon,
          created_at: now,
          updated_at: now,
          last_viewed_at: null,
          deleted_at: null,
          deleted_root_id: null,
        })
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new Error('insert into entities returned no row');
      await publisher.publish(
        {
          definition: entityCreated,
          aggregateId: row.id,
          aggregateRevision: row.revision,
          payload: { kind: row.kind, spaceId: row.space_id, parentId: row.parent_id },
        },
        tx,
      );
      return toRecord(row);
    },

    async get(tx, entityId) {
      return toRecord(await loadEntity(tx, entityId));
    },

    async children(tx, input) {
      let query = dbOf(tx)
        .selectFrom('entities as e')
        .select([
          'e.id',
          'e.kind',
          'e.title',
          'e.icon',
          'e.is_starred',
          sql<boolean>`exists (
            select 1 from entities c
            where c.parent_id = e.id and c.deleted_at is null and ${isTreeable('c.kind')}
          )`.as('has_children'),
        ])
        .where('e.space_id', '=', input.spaceId)
        .where('e.deleted_at', 'is', null)
        .where(isTreeable('e.kind'))
        .orderBy('e.position');
      query =
        input.parentId === null ? query.where('e.parent_id', 'is', null) : query.where('e.parent_id', '=', input.parentId);
      const rows = await query.execute();
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        icon: row.icon,
        isStarred: row.is_starred,
        hasChildren: row.has_children,
      }));
    },

    async ancestors(tx, entityId) {
      await loadEntity(tx, entityId);
      const { rows } = await sql<Breadcrumb>`
        with recursive walk as (
          select e.id, e.title, e.icon, e.parent_id, 0 as n
          from entities e
          where e.id = (select parent_id from entities where id = ${entityId})
          union all
          select e.id, e.title, e.icon, e.parent_id, w.n + 1
          from entities e
          inner join walk w on e.id = w.parent_id
          where w.n < ${MAX_TREE_DEPTH + 8}
        )
        select id, title, icon from walk order by n desc
      `.execute(dbOf(tx));
      return rows;
    },

    async move(tx, input) {
      await lockOwnerTree(tx);
      const current = await loadEntity(tx, input.entityId);
      requireAlive(current);
      requireTreeable(current.kind);
      const space = await loadSpace(tx, input.targetSpaceId);
      if (space.archived_at !== null) throw spaceArchived();
      if (input.newParentId !== null) {
        await requireParent(tx, input.newParentId, input.targetSpaceId);
        if (await wouldCycle(tx, input.entityId, input.newParentId)) throw treeCycle();
        const parentLevel = await nodeLevel(tx, input.newParentId);
        const height = await liveHeight(tx, input.entityId);
        if (parentLevel + height > MAX_TREE_DEPTH) throw treeTooDeep();
      } else if ((await liveHeight(tx, input.entityId)) > MAX_TREE_DEPTH) {
        throw treeTooDeep();
      }
      const siblings = await aliveSiblings(tx, input.targetSpaceId, input.newParentId, input.entityId);
      const position = moveKey(siblings, input.beforeId, input.afterId);
      const now = clock.now();
      // Only the root is written; entities_parent_fk ON UPDATE CASCADE carries the subtree, including trash.
      const row = await dbOf(tx)
        .updateTable('entities')
        .set({
          space_id: input.targetSpaceId,
          parent_id: input.newParentId,
          position,
          revision: sql`revision + 1`,
          updated_at: now,
        })
        .where('id', '=', input.entityId)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw entityNotFound();
      await publisher.publish(
        {
          definition: entityMoved,
          aggregateId: row.id,
          aggregateRevision: row.revision,
          payload: {
            kind: row.kind,
            fromSpaceId: current.space_id,
            toSpaceId: row.space_id,
            fromParentId: current.parent_id,
            toParentId: row.parent_id,
          },
        },
        tx,
      );
      return toRecord(row);
    },

    async trash(tx, entityId) {
      await lockOwnerTree(tx);
      const current = await loadEntity(tx, entityId);
      requireAlive(current);
      const now = clock.now();
      // Walk only live rows so an earlier trash root under this node keeps its own deleted_root_id.
      const { rows } = await sql<{ id: string; kind: string; revision: number }>`
        with recursive tree as (
          select id from entities where id = ${entityId} and deleted_at is null
          union all
          select e.id from entities e
          inner join tree t on e.parent_id = t.id
          where e.deleted_at is null
        )
        update entities set
          deleted_at = ${now},
          deleted_root_id = ${entityId},
          revision = revision + 1,
          updated_at = ${now}
        where id in (select id from tree)
        returning id, kind, revision
      `.execute(dbOf(tx));
      const root = rows.find((row) => row.id === entityId);
      if (!root) throw entityNotFound();
      await publisher.publish(
        {
          definition: entityDeleted,
          aggregateId: entityId,
          aggregateRevision: root.revision,
          payload: { kind: root.kind, rootId: entityId },
        },
        tx,
      );
      return { rootId: entityId, count: rows.length };
    },

    async restore(tx, rootId) {
      await lockOwnerTree(tx);
      const current = await loadTrashRoot(tx, rootId);
      const originalParent =
        current.parent_id === null
          ? undefined
          : await dbOf(tx).selectFrom('entities').selectAll().where('id', '=', current.parent_id).executeTakeFirst();
      const originalParentAlive = originalParent !== undefined && originalParent.deleted_at === null;
      // A non-treeable root has no place at the space root, so it needs its page back.
      const rootIsTreeable = registry.entityKind(current.kind)?.treeable === true;
      if (!rootIsTreeable && !originalParentAlive) throw parentInTrash();
      // The old parent may have moved deeper while the subtree sat in trash.
      const parentFits =
        originalParentAlive &&
        (!rootIsTreeable || (await nodeLevel(tx, originalParent.id)) + (await trashedHeight(tx, rootId)) <= MAX_TREE_DEPTH);
      const newParentId = parentFits ? current.parent_id : null;
      const spaceId = parentFits ? originalParent.space_id : current.space_id;
      const siblings = await aliveSiblings(tx, spaceId, newParentId);
      const taken = siblings.some((row) => row.position === current.position);
      const last = siblings[siblings.length - 1];
      const position = taken ? generateKeyBetween(last?.position ?? null, null) : current.position;
      const now = clock.now();
      // Clearing deleted_at re-enters the sibling unique index, so the root must land on a free key in this statement.
      const { rows } = await sql<EntityRow>`
        update entities set
          deleted_at = null,
          deleted_root_id = null,
          revision = revision + 1,
          updated_at = ${now},
          parent_id = case when id = ${rootId} then ${newParentId} else parent_id end,
          position = case when id = ${rootId} then ${position} else position end
        where deleted_root_id = ${rootId}
        returning *
      `.execute(dbOf(tx));
      const root = rows.find((row) => row.id === rootId);
      if (!root) throw trashItemNotFound();
      const space = await loadSpace(tx, root.space_id);
      await publisher.publish(
        {
          definition: entityRestored,
          aggregateId: root.id,
          aggregateRevision: root.revision,
          payload: { kind: root.kind, rootId: root.id },
        },
        tx,
      );
      return {
        entityId: root.id,
        spaceSlug: space.slug,
        parentId: root.parent_id,
        restoredToRoot: root.parent_id === null,
        spaceArchived: space.archived_at !== null,
        count: rows.length,
      };
    },

    async purge(tx, rootId) {
      await lockOwnerTree(tx);
      await loadTrashRoot(tx, rootId);
      const { rows } = await sql<{ id: string }>`
        delete from entities where deleted_root_id = ${rootId} returning id
      `.execute(dbOf(tx));
      return { count: rows.length };
    },

    async emptyTrash(tx) {
      await lockOwnerTree(tx);
      return deleteTrashRoots(tx, null);
    },

    async purgeExpired(tx) {
      await lockOwnerTree(tx);
      const cutoff = new Date(clock.now().getTime() - RETENTION_MS);
      return deleteTrashRoots(tx, cutoff);
    },

    async trashRoots(tx) {
      const { rows } = await sql<{
        root_id: string;
        kind: string;
        title: string;
        icon: string | null;
        space_name: string;
        parent_title: string | null;
        descendant_count: number;
        attached_count: number;
        deleted_at: Date;
      }>`
        select
          r.id as root_id,
          r.kind,
          r.title,
          r.icon,
          s.name as space_name,
          p.title as parent_title,
          (select count(*)::int from entities d
            where d.deleted_root_id = r.id and d.id <> r.id and ${isTreeable('d.kind')}) as descendant_count,
          (select count(*)::int from entities d
            where d.deleted_root_id = r.id and d.id <> r.id and not ${isTreeable('d.kind')}) as attached_count,
          r.deleted_at
        from entities r
        inner join spaces s on s.id = r.space_id
        left join entities p on p.id = r.parent_id
        where r.deleted_at is not null and r.deleted_root_id = r.id
        order by r.deleted_at desc
      `.execute(dbOf(tx));
      return rows.map((row) => ({
        rootId: row.root_id,
        kind: row.kind,
        title: row.title,
        icon: row.icon,
        spaceName: row.space_name,
        parentTitle: row.parent_title,
        descendantCount: row.descendant_count,
        attachedCount: row.attached_count,
        deletedAt: row.deleted_at.toISOString(),
        purgeAt: new Date(row.deleted_at.getTime() + RETENTION_MS).toISOString(),
      }));
    },

    async setTitle(tx, entityId, title) {
      return touchEntity(tx, entityId, ['title'], { title });
    },

    async setIcon(tx, entityId, icon) {
      return mutateAlive(tx, entityId, ['icon'], { icon });
    },

    async setStarred(tx, entityId, starred) {
      return mutateAlive(tx, entityId, ['isStarred'], { is_starred: starred });
    },

    async touch(tx, entityId, fields, changes) {
      return touchEntity(tx, entityId, fields, changes);
    },

    async recordView(tx, entityId) {
      const now = clock.now();
      const row = await dbOf(tx)
        .updateTable('entities')
        .set({ last_viewed_at: now, view_count: sql`view_count + 1` })
        .where('id', '=', entityId)
        .returning('id')
        .executeTakeFirst();
      if (!row) throw entityNotFound();
    },

    async starred(tx) {
      const rows = await dbOf(tx)
        .selectFrom('entities')
        .innerJoin('spaces', 'spaces.id', 'entities.space_id')
        .select([
          'entities.id',
          'entities.kind',
          'entities.title',
          'entities.icon',
          'entities.space_id',
          'spaces.slug',
        ])
        .where('entities.is_starred', '=', true)
        .where('entities.deleted_at', 'is', null)
        .where(isTreeable('entities.kind'))
        .orderBy(sql`lower(entities.title)`)
        .execute();
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        icon: row.icon,
        spaceId: row.space_id,
        spaceSlug: row.slug,
      }));
    },

    async recentInSpace(tx, spaceId, limit) {
      const rows = await dbOf(tx)
        .selectFrom('entities')
        .innerJoin('spaces', 'spaces.id', 'entities.space_id')
        .select([
          'entities.id',
          'entities.kind',
          'entities.title',
          'entities.icon',
          'entities.space_id',
          'entities.updated_at',
          'spaces.slug',
        ])
        .where('entities.space_id', '=', spaceId)
        .where('entities.deleted_at', 'is', null)
        .where(isTreeable('entities.kind'))
        .orderBy('entities.updated_at', 'desc')
        .limit(limit)
        .execute();
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        icon: row.icon,
        spaceId: row.space_id,
        spaceSlug: row.slug,
        updatedAt: row.updated_at.toISOString(),
      }));
    },

    async subtreeCounts(tx, entityIds) {
      const counts = new Map<string, number>(entityIds.map((id) => [id, 0]));
      if (entityIds.length === 0) return counts;
      const { rows } = await sql<{ root: string; n: number }>`
        with recursive tree as (
          select id, id as root
          from entities
          where id in (${sql.join(entityIds)}) and deleted_at is null
          union all
          select e.id, t.root
          from entities e
          inner join tree t on e.parent_id = t.id
          where e.deleted_at is null and ${isTreeable('e.kind')}
        )
        select root, (count(*)::int - 1) as n from tree group by root
      `.execute(dbOf(tx));
      for (const row of rows) counts.set(row.root, row.n);
      return counts;
    },
  };
}
