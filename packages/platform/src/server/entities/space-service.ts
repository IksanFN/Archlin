import { ownerOf, sqlFor } from '@archlin/db/scoped';
import { NotFoundError, ValidationError } from '@archlin/kernel';
import type { Clock, Ids, ModuleRegistry, ReadTx, WriteTx } from '@archlin/kernel';
import { generateKeyBetween } from 'fractional-indexing';
import { sql } from 'kysely';
import type { CreateSpaceInput, ReorderInput, SpaceSummary, UpdateSpaceInput } from '../../contracts';
import { lockOwnerTree } from './lock';
import type { EntitiesDatabase, SpacesTable } from './schema';
import { nextFreeSlug, slugCandidate } from './slug';

export interface SpaceService {
  list(tx: ReadTx, opts: { includeArchived: boolean }): Promise<SpaceSummary[]>;
  get(tx: ReadTx, id: string): Promise<SpaceSummary>;
  getBySlug(tx: ReadTx, slug: string): Promise<SpaceSummary>;
  create(tx: WriteTx, input: CreateSpaceInput): Promise<SpaceSummary>;
  update(tx: WriteTx, input: UpdateSpaceInput): Promise<SpaceSummary>;
  reorder(tx: WriteTx, input: ReorderInput): Promise<void>;
  archive(tx: WriteTx, id: string): Promise<SpaceSummary>;
  unarchive(tx: WriteTx, id: string): Promise<SpaceSummary>;
}

const spaceNotFound = () => new NotFoundError('space_not_found', 'Space tidak ditemukan');
const invalidSibling = () => new ValidationError('invalid_sibling', 'Saudara tidak valid');

function dbOf(tx: ReadTx) {
  return sqlFor<EntitiesDatabase>(tx);
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function toSummary(row: SpacesTable, pageCount: number): SpaceSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    archivedAt: row.archived_at?.toISOString() ?? null,
    pageCount,
  };
}

export function createSpaceService(deps: { registry: ModuleRegistry; ids: Ids; clock: Clock }): SpaceService {
  const { registry, ids, clock } = deps;

  async function pageCounts(tx: ReadTx, spaceIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>(spaceIds.map((id) => [id, 0]));
    if (spaceIds.length === 0) return counts;
    const rows = await dbOf(tx)
      .selectFrom('entities')
      .select(['space_id', 'kind'])
      .select(sql<number>`count(*)::int`.as('n'))
      .where('deleted_at', 'is', null)
      .where('space_id', 'in', [...spaceIds])
      .groupBy(['space_id', 'kind'])
      .execute();
    // treeable is a registry property, not a column, so the filter stays in process.
    for (const row of rows) {
      if (registry.entityKind(row.kind)?.treeable !== true) continue;
      counts.set(row.space_id, (counts.get(row.space_id) ?? 0) + row.n);
    }
    return counts;
  }

  async function summarize(tx: ReadTx, row: SpacesTable): Promise<SpaceSummary> {
    const counts = await pageCounts(tx, [row.id]);
    return toSummary(row, counts.get(row.id) ?? 0);
  }

  async function loadById(tx: ReadTx, id: string): Promise<SpacesTable> {
    const row = await dbOf(tx).selectFrom('spaces').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw spaceNotFound();
    return row;
  }

  return {
    async list(tx, opts) {
      let query = dbOf(tx).selectFrom('spaces').selectAll().orderBy('position');
      if (!opts.includeArchived) query = query.where('archived_at', 'is', null);
      const rows = await query.execute();
      const counts = await pageCounts(
        tx,
        rows.map((row) => row.id),
      );
      return rows.map((row) => toSummary(row, counts.get(row.id) ?? 0));
    },

    async get(tx, id) {
      return summarize(tx, await loadById(tx, id));
    },

    async getBySlug(tx, slug) {
      const row = await dbOf(tx).selectFrom('spaces').selectAll().where('slug', '=', slug).executeTakeFirst();
      if (!row) throw spaceNotFound();
      return summarize(tx, row);
    },

    async create(tx, input) {
      await lockOwnerTree(tx);
      const now = clock.now();
      const name = normalizeName(input.name);
      const db = dbOf(tx);
      const taken = new Set((await db.selectFrom('spaces').select('slug').execute()).map((row) => row.slug));
      const last = await db.selectFrom('spaces').select('position').orderBy('position', 'desc').limit(1).executeTakeFirst();
      const row = await db
        .insertInto('spaces')
        .values({
          id: ids.uuidv7(),
          owner_id: ownerOf(tx),
          name,
          slug: nextFreeSlug(slugCandidate(name), taken),
          icon: input.icon,
          position: generateKeyBetween(last?.position ?? null, null),
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new Error('insert into spaces returned no row');
      return toSummary(row, 0);
    },

    async update(tx, input) {
      const now = clock.now();
      await loadById(tx, input.id);
      const patch: { name?: string; icon?: string | null; updated_at: Date } = { updated_at: now };
      if (input.name !== undefined) patch.name = normalizeName(input.name);
      if (input.icon !== undefined) patch.icon = input.icon;
      const row = await dbOf(tx)
        .updateTable('spaces')
        .set(patch)
        .where('id', '=', input.id)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw spaceNotFound();
      return summarize(tx, row);
    },

    async reorder(tx, input) {
      await lockOwnerTree(tx);
      const rows = await dbOf(tx).selectFrom('spaces').select(['id', 'position']).orderBy('position').execute();
      const current = rows.find((row) => row.id === input.id);
      if (!current) throw spaceNotFound();
      const others = rows.filter((row) => row.id !== input.id);

      let position: string;
      if (input.afterId !== null) {
        const afterIndex = others.findIndex((row) => row.id === input.afterId);
        const after = others[afterIndex];
        if (afterIndex < 0 || after === undefined) throw invalidSibling();
        const next = others[afterIndex + 1];
        position = generateKeyBetween(after.position, next?.position ?? null);
      } else if (input.beforeId !== null) {
        const beforeIndex = others.findIndex((row) => row.id === input.beforeId);
        const before = others[beforeIndex];
        if (beforeIndex < 0 || before === undefined) throw invalidSibling();
        const prev = others[beforeIndex - 1];
        position = generateKeyBetween(prev?.position ?? null, before.position);
      } else {
        const last = others[others.length - 1];
        position = generateKeyBetween(last?.position ?? null, null);
      }

      await dbOf(tx)
        .updateTable('spaces')
        .set({ position, updated_at: clock.now() })
        .where('id', '=', input.id)
        .execute();
    },

    async archive(tx, id) {
      await loadById(tx, id);
      const now = clock.now();
      const row = await dbOf(tx)
        .updateTable('spaces')
        .set({ archived_at: now, updated_at: now })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw spaceNotFound();
      return summarize(tx, row);
    },

    async unarchive(tx, id) {
      await loadById(tx, id);
      const row = await dbOf(tx)
        .updateTable('spaces')
        .set({ archived_at: null, updated_at: clock.now() })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw spaceNotFound();
      return summarize(tx, row);
    },
  };
}
