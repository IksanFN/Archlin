import { sqlFor } from '@archlin/db/scoped';
import { NotFoundError } from '@archlin/kernel';
import type { Clock, Ids, ReadTx, WriteTx } from '@archlin/kernel';
import type { LinkService, TreeService } from '@archlin/platform/server';
import { sql } from 'kysely';
import { VERSION_PAGE_SIZE } from '../shared/limits';
import type { ListVersionsInput, RestoreVersionInput, SnapshotPageInput, VersionInput } from '../shared/inputs';
import type { RestoreVersionResult, SnapshotResult, VersionDetail, VersionPage } from '../shared/types';
import { normalizeDocument } from './document';
import type { PageState } from './hash';
import {
  asContent,
  asRecord,
  changedPageFields,
  contextOf,
  createPageWriter,
  requireAlive,
  requireVersion,
} from './page-writer';
import type { KnowledgeDatabase } from './schema';
import { shouldSnapshot } from './snapshot-policy';
import { insertVersion, latestVersion } from './version-store';

export interface VersionService {
  snapshot(tx: WriteTx, input: SnapshotPageInput): Promise<SnapshotResult>;
  list(tx: ReadTx, input: ListVersionsInput): Promise<VersionPage>;
  get(tx: ReadTx, input: VersionInput): Promise<VersionDetail>;
  restore(tx: WriteTx, input: RestoreVersionInput): Promise<RestoreVersionResult>;
}

function dbOf(tx: ReadTx) {
  return sqlFor<KnowledgeDatabase>(tx);
}

function versionNotFound(): never {
  throw new NotFoundError('version_not_found', 'Versi tidak ditemukan');
}

export function createVersionService(deps: {
  tree: TreeService;
  links: LinkService;
  clock: Clock;
  ids: Ids;
}): VersionService {
  const { tree, links, clock, ids } = deps;
  const writer = createPageWriter({ tree, links, clock, ids });

  return {
    async snapshot(tx, input) {
      const locked = await writer.lockPage(tx, input.entityId);
      requireAlive(locked);
      const latest = await latestVersion(tx, input.entityId);
      const wanted = shouldSnapshot({
        reason: input.reason,
        now: clock.now(),
        lastSavedAt: new Date(locked.lastSavedAt),
        currentHash: locked.contentHash,
        lastSnapshotHash: latest?.contentHash ?? null,
      });
      if (!wanted) return { status: 'unchanged', versionId: latest?.id ?? null };
      const versionId = await insertVersion(tx, { ids, clock }, {
        snapshot: locked,
        reason: input.reason,
        label: input.label,
      });
      return { status: 'created', versionId };
    },

    async list(tx, input) {
      let query = dbOf(tx)
        .selectFrom('kb_page_versions')
        .select(['id', 'version', 'reason', 'label', 'created_at'])
        .where('entity_id', '=', input.entityId);
      if (input.before !== null) {
        const cursor = await dbOf(tx)
          .selectFrom('kb_page_versions')
          .select(['id', 'created_at'])
          .where('id', '=', input.before)
          .where('entity_id', '=', input.entityId)
          .executeTakeFirst();
        if (!cursor) versionNotFound();
        query = query.where(sql<boolean>`(created_at, id) < (${cursor.created_at}, ${cursor.id})`);
      }
      const rows = await query
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(VERSION_PAGE_SIZE + 1)
        .execute();
      const page = rows.slice(0, VERSION_PAGE_SIZE);
      return {
        items: page.map((row) => ({
          id: row.id,
          version: row.version,
          reason: row.reason,
          label: row.label,
          createdAt: row.created_at.toISOString(),
        })),
        nextCursor: rows.length > VERSION_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      };
    },

    async get(tx, input) {
      const row = await dbOf(tx)
        .selectFrom('kb_page_versions as v')
        .leftJoin('kb_note_types as t', (join) =>
          join.onRef('t.id', '=', 'v.note_type_id').onRef('t.owner_id', '=', 'v.owner_id'),
        )
        .select([
          'v.id',
          'v.version',
          'v.reason',
          'v.label',
          'v.created_at',
          'v.title',
          'v.content',
          'v.content_text',
          'v.properties',
          'v.summary',
          'v.when_to_use',
          'v.source',
          'v.aliases',
          'v.note_type_id',
          't.name as note_type_name',
        ])
        .where('v.id', '=', input.versionId)
        .where('v.entity_id', '=', input.entityId)
        .executeTakeFirst();
      if (!row) versionNotFound();
      return {
        id: row.id,
        version: row.version,
        reason: row.reason,
        label: row.label,
        createdAt: row.created_at.toISOString(),
        title: row.title,
        content: asContent(row.content),
        contentText: row.content_text,
        context: contextOf(row),
        properties: asRecord(row.properties),
        noteType: { id: row.note_type_id, name: row.note_type_name },
      };
    },

    async restore(tx, input) {
      const locked = await writer.lockPage(tx, input.entityId);
      requireAlive(locked);
      requireVersion(locked, input.baseVersion);
      const version = await dbOf(tx)
        .selectFrom('kb_page_versions')
        .selectAll()
        .where('id', '=', input.versionId)
        .where('entity_id', '=', input.entityId)
        .executeTakeFirst();
      if (!version) versionNotFound();

      const latest = await latestVersion(tx, input.entityId);
      const keepCurrent = shouldSnapshot({
        reason: 'pre_restore',
        now: clock.now(),
        lastSavedAt: new Date(locked.lastSavedAt),
        currentHash: locked.contentHash,
        lastSnapshotHash: latest?.contentHash ?? null,
      });
      const preRestoreVersionId = keepCurrent
        ? await insertVersion(tx, { ids, clock }, { snapshot: locked, reason: 'pre_restore', label: null })
        : null;

      // A deleted note type cannot come back, so the page keeps its current one and the old values stay as hidden properties.
      const typeStillExists = await dbOf(tx)
        .selectFrom('kb_note_types')
        .select('id')
        .where('id', '=', version.note_type_id)
        .executeTakeFirst();
      const next: PageState = {
        title: version.title,
        content: normalizeDocument(version.content),
        context: contextOf(version),
        properties: asRecord(version.properties),
        noteTypeId: typeStillExists ? version.note_type_id : locked.noteTypeId,
      };
      const saved = await writer.writePage(tx, locked, next, changedPageFields(locked, next));
      return { version: saved.version, savedAt: saved.savedAt, preRestoreVersionId };
    },
  };
}
