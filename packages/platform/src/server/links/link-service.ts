import { ownerOf, sqlFor } from '@archlin/db/scoped';
import { ValidationError } from '@archlin/kernel';
import type { Clock, Ids, ModuleRegistry, ReadTx, WriteTx } from '@archlin/kernel';
import type { GeneratedAlways } from 'kysely';
import { sql } from 'kysely';
import { LINK_SNIPPET_MAX, LINK_TITLE_MAX } from '../../contracts';
import type { InboundLink, LinkKind, LinkRef, OutboundLink } from '../../contracts';
import type { EntitiesDatabase } from '../entities/schema';
import { normalizeTitle } from '../entities/tree-service';
import { pickTarget } from './pick-target';
import type { TargetCandidate } from './pick-target';

export interface LinkService {
  sync(tx: WriteTx, input: LinkSyncInput): Promise<void>;
  resolvePending(tx: WriteTx, target: { entityId: string; title: string }): Promise<number>;
  outbound(tx: ReadTx, sourceId: string): Promise<OutboundLink[]>;
  inbound(tx: ReadTx, target: { entityId: string; title: string }): Promise<InboundLink[]>;
  // What a typed title in sourceId would resolve to, by the same rule sync uses (a page never links itself by title).
  findTarget(tx: ReadTx, input: { title: string; sourceId: string; spaceId: string }): Promise<TitleTarget>;
}

export interface LinkSyncInput {
  sourceId: string;
  spaceId: string;
  refs: readonly LinkRef[];
  // A copy of a page takes over how the original resolved its titles, with targets inside the copied subtree remapped.
  inheritFrom?: { sourceId: string; remap: ReadonlyMap<string, string> };
}

export type TitleTarget = { kind: 'none' } | { kind: 'one'; id: string } | { kind: 'many' };

type ResolvedBy = 'id' | 'title' | 'none';

interface LinksTable {
  id: string;
  owner_id: string;
  source_id: string;
  target_id: string | null;
  target_title: string;
  target_key: GeneratedAlways<string>;
  kind: LinkKind;
  resolved_by: ResolvedBy;
  snippet: string;
  position: number;
  created_at: Date;
}

interface LinksDatabase extends EntitiesDatabase {
  links: LinksTable;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const linkTitleTooLong = () => new ValidationError('link_title_too_long', 'Judul link terlalu panjang');

function dbOf(tx: ReadTx) {
  return sqlFor<LinksDatabase>(tx);
}

function prepare(refs: readonly LinkRef[]): LinkRef[] {
  const prepared: LinkRef[] = [];
  for (const ref of refs) {
    const targetTitle = normalizeTitle(ref.targetTitle);
    if (targetTitle.length === 0) continue;
    if (targetTitle.length > LINK_TITLE_MAX) throw linkTitleTooLong();
    prepared.push({ ...ref, targetTitle, snippet: ref.snippet.slice(0, LINK_SNIPPET_MAX) });
  }
  return prepared;
}

export function createLinkService(deps: { registry: ModuleRegistry; ids: Ids; clock: Clock }): LinkService {
  const { registry, ids, clock } = deps;
  const treeableKinds = registry.treeableKinds;

  async function existingTreeableIds(tx: ReadTx, candidateIds: readonly string[]): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();
    const { rows } = await sql<{ id: string }>`
      select id from entities where id = any(${candidateIds}::uuid[]) and kind = any(${treeableKinds}::text[])
    `.execute(dbOf(tx));
    return new Set(rows.map((row) => row.id));
  }

  // A link that resolved once keeps its target for as long as the source still uses that title (R15).
  async function stickyTargets(tx: ReadTx, sourceId: string, titles: readonly string[]): Promise<Map<string, string>> {
    if (titles.length === 0) return new Map();
    const { rows } = await sql<{ input: string; target_id: string }>`
      select distinct on (t.title) t.title as input, l.target_id
      from unnest(${titles}::text[]) as t(title)
      inner join links l on l.target_key = lower(t.title)
      where l.source_id = ${sourceId} and l.target_id is not null
      order by t.title, l.position
    `.execute(dbOf(tx));
    return new Map(rows.map((row) => [row.input, row.target_id]));
  }

  async function liveCandidates(
    tx: ReadTx,
    titles: readonly string[],
    excludeId: string | null,
  ): Promise<Map<string, TargetCandidate[]>> {
    const byTitle = new Map<string, TargetCandidate[]>();
    if (titles.length === 0) return byTitle;
    const { rows } = await sql<{ input: string; id: string; space_id: string }>`
      select t.title as input, e.id, e.space_id
      from unnest(${titles}::text[]) as t(title)
      inner join entities e on lower(e.title) = lower(t.title)
      where e.deleted_at is null and e.id is distinct from ${excludeId}::uuid and e.kind = any(${treeableKinds}::text[])
    `.execute(dbOf(tx));
    for (const row of rows) {
      const list = byTitle.get(row.input) ?? [];
      list.push({ id: row.id, spaceId: row.space_id });
      byTitle.set(row.input, list);
    }
    return byTitle;
  }

  return {
    async sync(tx, input) {
      const refs = prepare(input.refs);
      const claimedIds = [...new Set(refs.flatMap((ref) => (ref.targetId !== null && UUID.test(ref.targetId) ? [ref.targetId] : [])))];
      const validIds = await existingTreeableIds(tx, claimedIds);
      const byTitle = refs.filter((ref) => ref.targetId === null || !validIds.has(ref.targetId));
      const titles = [...new Set(byTitle.map((ref) => ref.targetTitle))];
      const sticky = await stickyTargets(tx, input.sourceId, titles);
      if (input.inheritFrom !== undefined) {
        const { sourceId, remap } = input.inheritFrom;
        const inherited = await stickyTargets(tx, sourceId, titles.filter((title) => !sticky.has(title)));
        for (const [title, targetId] of inherited) sticky.set(title, remap.get(targetId) ?? targetId);
      }
      const candidates = await liveCandidates(
        tx,
        titles.filter((title) => !sticky.has(title)),
        input.sourceId,
      );

      const now = clock.now();
      const owner = ownerOf(tx);
      const rows = refs.map((ref, position) => {
        let targetId: string | null;
        let resolvedBy: ResolvedBy;
        if (ref.targetId !== null && validIds.has(ref.targetId)) {
          targetId = ref.targetId;
          resolvedBy = 'id';
        } else {
          targetId = sticky.get(ref.targetTitle) ?? pickTarget(candidates.get(ref.targetTitle) ?? [], input.spaceId);
          resolvedBy = targetId === null ? 'none' : 'title';
        }
        return {
          id: ids.uuidv7(),
          owner_id: owner,
          source_id: input.sourceId,
          target_id: targetId,
          target_title: ref.targetTitle,
          kind: ref.kind,
          resolved_by: resolvedBy,
          snippet: ref.snippet,
          position,
          created_at: now,
        };
      });

      await dbOf(tx).deleteFrom('links').where('source_id', '=', input.sourceId).execute();
      if (rows.length > 0) await dbOf(tx).insertInto('links').values(rows).execute();
    },

    async resolvePending(tx, target) {
      const title = normalizeTitle(target.title);
      if (title.length === 0) return 0;
      const { rows: waiting } = await sql<{ id: string; space_id: string }>`
        select l.id, e.space_id
        from links l
        inner join entities e on e.id = l.source_id
        where l.target_id is null and l.target_key = lower(${title}) and l.source_id <> ${target.entityId}
      `.execute(dbOf(tx));
      if (waiting.length === 0) return 0;
      const pool = (await liveCandidates(tx, [title], null)).get(title) ?? [];
      const matching = waiting.filter((row) => pickTarget(pool, row.space_id) === target.entityId).map((row) => row.id);
      if (matching.length === 0) return 0;
      const updated = await dbOf(tx)
        .updateTable('links')
        .set({ target_id: target.entityId, resolved_by: 'title' })
        .where('id', 'in', matching)
        .executeTakeFirst();
      return Number(updated.numUpdatedRows);
    },

    async outbound(tx, sourceId) {
      const { rows } = await sql<{
        kind: LinkKind;
        target_title: string;
        target_key: string;
        target_id: string | null;
        resolved_by: ResolvedBy;
        t_title: string | null;
        t_icon: string | null;
        t_trashed: boolean | null;
        t_space_slug: string | null;
      }>`
        select l.kind, l.target_title, l.target_key, l.target_id, l.resolved_by,
               t.title as t_title, t.icon as t_icon, (t.deleted_at is not null) as t_trashed, s.slug as t_space_slug
        from links l
        left join entities t on t.id = l.target_id
        left join spaces s on s.id = t.space_id
        where l.source_id = ${sourceId}
        order by l.position
      `.execute(dbOf(tx));
      const unresolved = [...new Set(rows.filter((row) => row.target_id === null).map((row) => row.target_title))];
      const candidates = await liveCandidates(tx, unresolved, sourceId);

      const seen = new Set<string>();
      const result: OutboundLink[] = [];
      for (const row of rows) {
        const key = row.target_id !== null && row.resolved_by === 'id' ? row.target_id : `t:${row.target_key}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const target =
          row.target_id !== null && row.t_title !== null && row.t_space_slug !== null
            ? {
                id: row.target_id,
                title: row.t_title,
                icon: row.t_icon,
                spaceSlug: row.t_space_slug,
                trashed: row.t_trashed === true,
              }
            : null;
        result.push({
          key,
          kind: row.kind,
          targetTitle: row.target_title,
          target,
          ambiguous: target === null && (candidates.get(row.target_title)?.length ?? 0) > 1,
        });
      }
      return result;
    },

    async findTarget(tx, input) {
      const title = normalizeTitle(input.title);
      if (title.length === 0) return { kind: 'none' };
      const pool = (await liveCandidates(tx, [title], input.sourceId)).get(title) ?? [];
      if (pool.length === 0) return { kind: 'none' };
      const id = pickTarget(pool, input.spaceId);
      return id === null ? { kind: 'many' } : { kind: 'one', id };
    },

    async inbound(tx, target) {
      const title = normalizeTitle(target.title);
      const { rows } = await sql<{
        source_id: string;
        kind: LinkKind;
        snippet: string;
        title: string;
        icon: string | null;
        space_slug: string;
      }>`
        select * from (
          select distinct on (l.source_id)
            l.source_id, l.kind, l.snippet, e.title, e.icon, s.slug as space_slug
          from links l
          inner join entities e on e.id = l.source_id
          inner join spaces s on s.id = e.space_id
          where e.deleted_at is null
            and l.source_id <> ${target.entityId}
            and (
              l.target_id = ${target.entityId}
              or (l.target_id is null and ${title} <> '' and l.target_key = lower(${title}))
            )
          order by l.source_id, l.position
        ) sources
        order by lower(sources.title), sources.source_id
      `.execute(dbOf(tx));
      return rows.map((row) => ({
        sourceId: row.source_id,
        title: row.title,
        icon: row.icon,
        spaceSlug: row.space_slug,
        snippet: row.snippet,
        kind: row.kind,
      }));
    },
  };
}
