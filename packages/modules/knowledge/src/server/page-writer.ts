import { sqlFor } from '@archlin/db/scoped';
import { ConflictError, NotFoundError } from '@archlin/kernel';
import type { Clock, Ids, ReadTx, WriteTx } from '@archlin/kernel';
import type { EntitiesDatabase, LinkService, TreeService } from '@archlin/platform/server';
import type { JSONContent } from '@tiptap/core';
import { sql } from 'kysely';
import { canonicalJson } from '../shared/canonical-json';
import type { ContextFields } from '../shared/inputs';
import type { SaveResult } from '../shared/types';
import { documentAttachmentIds, syncAttachmentRefs } from './attachment-refs';
import { documentText, parseDocument } from './document';
import { pageStateHash, type PageState } from './hash';
import { documentLinkRefs } from './links';
import type { KnowledgeDatabase } from './schema';
import { shouldSnapshot } from './snapshot-policy';
import { insertVersion, latestSnapshotHash } from './version-store';

type PageDatabase = KnowledgeDatabase & EntitiesDatabase;

export interface LockedPage {
  entityId: string;
  spaceId: string;
  title: string;
  content: JSONContent;
  context: ContextFields;
  properties: Record<string, unknown>;
  noteTypeId: string;
  contentHash: string;
  contentText: string;
  version: number;
  lastSavedAt: string;
  deletedAt: Date | null;
}

interface LockRow {
  entity_id: string;
  note_type_id: string;
  content: unknown;
  content_text: string;
  content_hash: string;
  properties: unknown;
  summary: string | null;
  when_to_use: string | null;
  source: string | null;
  aliases: string[];
  version: number;
  last_saved_at: Date;
  title: string;
  space_id: string;
  deleted_at: Date | null;
}

function dbOf(tx: ReadTx) {
  return sqlFor<PageDatabase>(tx);
}

export function pageInTrash(): never {
  throw new ConflictError('page_in_trash', 'Halaman ini ada di Trash');
}

export function pageConflict(currentVersion: number): never {
  throw new ConflictError('page_conflict', 'Halaman ini berubah di tab atau perangkat lain', { currentVersion });
}

export function requireAlive(locked: LockedPage): void {
  if (locked.deletedAt !== null) pageInTrash();
}

export function requireVersion(locked: LockedPage, expected: number): void {
  if (expected !== locked.version) pageConflict(locked.version);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function asContent(value: unknown): JSONContent {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JSONContent;
  }
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function contextOf(row: {
  summary: string | null;
  when_to_use: string | null;
  source: string | null;
  aliases: string[] | null;
}): ContextFields {
  return {
    summary: row.summary,
    whenToUse: row.when_to_use,
    source: row.source,
    aliases: row.aliases ?? [],
  };
}

function toLocked(row: LockRow): LockedPage {
  return {
    entityId: row.entity_id,
    spaceId: row.space_id,
    title: row.title,
    content: asContent(row.content),
    context: contextOf(row),
    properties: asRecord(row.properties),
    noteTypeId: row.note_type_id,
    contentHash: row.content_hash,
    contentText: row.content_text,
    version: row.version,
    lastSavedAt: row.last_saved_at.toISOString(),
    deletedAt: row.deleted_at,
  };
}

export function jsonbValue(value: unknown): string {
  return JSON.stringify(value);
}

export function changedPageFields(locked: LockedPage, next: PageState): string[] {
  const fields: string[] = [];
  if (locked.title !== next.title) fields.push('title');
  if (canonicalJson(locked.content) !== canonicalJson(next.content)) fields.push('content');
  if (canonicalJson(locked.context) !== canonicalJson(next.context)) fields.push('context');
  if (canonicalJson(locked.properties) !== canonicalJson(next.properties)) fields.push('properties');
  if (locked.noteTypeId !== next.noteTypeId) fields.push('noteType');
  return fields;
}

export function createPageWriter(deps: { tree: TreeService; links: LinkService; clock: Clock; ids: Ids }) {
  const { tree, links, clock, ids } = deps;

  return {
    async lockPage(tx: WriteTx, entityId: string): Promise<LockedPage> {
      const { rows } = await sql<LockRow>`
        select
          p.entity_id,
          p.note_type_id,
          p.content,
          p.content_text,
          p.content_hash,
          p.properties,
          p.summary,
          p.when_to_use,
          p.source,
          p.aliases,
          p.version,
          p.last_saved_at,
          e.title,
          e.space_id,
          e.deleted_at
        from kb_pages p
        inner join entities e on e.owner_id = p.owner_id and e.id = p.entity_id
        where p.entity_id = ${entityId}
        for update of p
      `.execute(dbOf(tx));
      const row = rows[0];
      if (!row) throw new NotFoundError('page_not_found', 'Halaman tidak ditemukan');
      return toLocked(row);
    },

    async writePage(
      tx: WriteTx,
      locked: LockedPage,
      next: PageState,
      fields: readonly string[],
    ): Promise<SaveResult> {
      const now = clock.now();
      const version = locked.version + 1;
      const idle = shouldSnapshot({
        reason: 'idle',
        now,
        lastSavedAt: new Date(locked.lastSavedAt),
        currentHash: locked.contentHash,
        lastSnapshotHash: await latestSnapshotHash(tx, locked.entityId),
      });
      if (idle) await insertVersion(tx, { ids, clock }, { snapshot: locked, reason: 'idle', label: null });
      const doc = parseDocument(next.content);
      const contentText = documentText(doc);
      const contentHash = pageStateHash(next);
      const updated = await dbOf(tx)
        .updateTable('kb_pages')
        .set({
          note_type_id: next.noteTypeId,
          content: jsonbValue(next.content),
          content_text: contentText,
          content_hash: contentHash,
          properties: jsonbValue(next.properties),
          summary: next.context.summary,
          when_to_use: next.context.whenToUse,
          source: next.context.source,
          aliases: [...next.context.aliases],
          version,
          last_saved_at: now,
        })
        .where('entity_id', '=', locked.entityId)
        .returning('entity_id')
        .executeTakeFirst();
      if (!updated) throw new NotFoundError('page_not_found', 'Halaman tidak ditemukan');
      if (fields.length > 0) {
        if (fields.includes('title')) {
          await tree.touch(tx, locked.entityId, fields, { title: next.title });
        } else {
          await tree.touch(tx, locked.entityId, fields);
        }
      }
      if (fields.includes('content')) {
        await links.sync(tx, { sourceId: locked.entityId, spaceId: locked.spaceId, refs: documentLinkRefs(doc) });
        await syncAttachmentRefs(tx, locked.entityId, documentAttachmentIds(doc));
      }
      if (fields.includes('title')) {
        await links.resolvePending(tx, { entityId: locked.entityId, title: next.title });
      }
      return { status: 'saved', version, savedAt: now.toISOString() };
    },
  };
}
