import { ownerOf, sqlFor } from '@archlin/db/scoped';
import { ConflictError } from '@archlin/kernel';
import type { Clock, Ids, ReadTx, WriteTx } from '@archlin/kernel';
import { sql } from 'kysely';
import type { TagRef } from '../../contracts';
import type { EntitiesDatabase } from './schema';
import type { TreeService } from './tree-service';

export interface TagService {
  suggest(tx: ReadTx, prefix: string, limit?: number): Promise<TagRef[]>;
  forEntity(tx: ReadTx, entityId: string): Promise<TagRef[]>;
  setForEntity(tx: WriteTx, entityId: string, names: readonly string[]): Promise<TagRef[]>;
}

function dbOf(tx: ReadTx) {
  return sqlFor<EntitiesDatabase>(tx);
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function uniqueNormalized(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = normalizeName(raw);
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function sameNameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const other = new Set(right.map((name) => name.toLowerCase()));
  return left.every((name) => other.has(name.toLowerCase()));
}

function toRef(row: { id: string; name: string }): TagRef {
  return { id: row.id, name: row.name };
}

export function createTagService(deps: { tree: TreeService; ids: Ids; clock: Clock }): TagService {
  const { tree, ids, clock } = deps;

  async function tagsForEntity(tx: ReadTx, entityId: string): Promise<TagRef[]> {
    const rows = await dbOf(tx)
      .selectFrom('tags')
      .innerJoin('entity_tags', 'entity_tags.tag_id', 'tags.id')
      .select(['tags.id', 'tags.name'])
      .where('entity_tags.entity_id', '=', entityId)
      .orderBy(sql`lower(tags.name)`)
      .execute();
    return rows.map(toRef);
  }

  async function loadByLowerNames(tx: ReadTx, names: readonly string[]): Promise<TagRef[]> {
    if (names.length === 0) return [];
    const rows = await dbOf(tx)
      .selectFrom('tags')
      .select(['id', 'name'])
      .where(sql<boolean>`lower(name) in (${sql.join(names.map((name) => sql`${name.toLowerCase()}`))})`)
      .execute();
    return rows.map(toRef);
  }

  async function resolveTags(tx: WriteTx, names: readonly string[]): Promise<TagRef[]> {
    if (names.length === 0) return [];
    const existing = await loadByLowerNames(tx, names);
    const byLower = new Map(existing.map((tag) => [tag.name.toLowerCase(), tag]));
    const now = clock.now();
    const ownerId = ownerOf(tx);
    const toInsert: Array<{ id: string; owner_id: string; name: string; color: string | null; created_at: Date }> = [];
    const resolved: TagRef[] = [];
    for (const name of names) {
      const found = byLower.get(name.toLowerCase());
      if (found !== undefined) {
        // tags has INSERT but no UPDATE: reuse the stored row and its spelling.
        resolved.push(found);
        continue;
      }
      const tag = { id: ids.uuidv7(), name };
      byLower.set(name.toLowerCase(), tag);
      resolved.push(tag);
      toInsert.push({ id: tag.id, owner_id: ownerId, name, color: null, created_at: now });
    }
    if (toInsert.length === 0) return resolved;
    // A parallel save may create the same name first; the unique index decides and the loser reuses that row.
    const created = await dbOf(tx)
      .insertInto('tags')
      .values(toInsert)
      .onConflict((conflict) => conflict.doNothing())
      .returning('id')
      .execute();
    const createdIds = new Set(created.map((row) => row.id));
    const lostIds = new Set(toInsert.filter((row) => !createdIds.has(row.id)).map((row) => row.id));
    if (lostIds.size === 0) return resolved;
    const lostNames = resolved.filter((tag) => lostIds.has(tag.id)).map((tag) => tag.name);
    const winners = new Map((await loadByLowerNames(tx, lostNames)).map((tag) => [tag.name.toLowerCase(), tag]));
    return resolved.map((tag) => {
      if (!lostIds.has(tag.id)) return tag;
      const winner = winners.get(tag.name.toLowerCase());
      if (winner === undefined) throw new Error('tag missing after insert conflict');
      return winner;
    });
  }

  return {
    async suggest(tx, prefix, limit = 10) {
      // starts_with, not LIKE: % and _ in the prefix stay literal.
      const rows = await dbOf(tx)
        .selectFrom('tags')
        .select(['id', 'name'])
        .where(sql<boolean>`starts_with(lower(name), lower(${prefix}))`)
        .orderBy(sql`lower(name)`)
        .limit(limit)
        .execute();
      return rows.map(toRef);
    },

    async forEntity(tx, entityId) {
      return tagsForEntity(tx, entityId);
    },

    async setForEntity(tx, entityId, names) {
      const entity = await tree.get(tx, entityId);
      if (entity.deletedAt !== null) throw new ConflictError('entity_in_trash', 'Entitas ada di sampah');

      const wanted = uniqueNormalized(names);
      const current = await tagsForEntity(tx, entityId);
      if (sameNameSet(current.map((tag) => tag.name), wanted)) return current;

      const resolved = await resolveTags(tx, wanted);
      const db = dbOf(tx);
      await db.deleteFrom('entity_tags').where('entity_id', '=', entityId).execute();
      if (resolved.length > 0) {
        await db
          .insertInto('entity_tags')
          .values(resolved.map((tag) => ({ owner_id: ownerOf(tx), entity_id: entityId, tag_id: tag.id })))
          .execute();
      }
      await tree.touch(tx, entityId, ['tags']);
      return tagsForEntity(tx, entityId);
    },
  };
}
