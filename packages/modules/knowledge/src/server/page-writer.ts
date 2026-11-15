import { sqlFor } from '@archlin/db/scoped';
import { NotFoundError } from '@archlin/kernel';
import type { Clock, ReadTx, WriteTx } from '@archlin/kernel';
import type { EntitiesDatabase, TreeService } from '@archlin/platform/server';
import type { JSONContent } from '@tiptap/core';
import { sql } from 'kysely';
import { canonicalJson } from '../shared/canonical-json';
import type { ContextFields } from '../shared/inputs';
import type { SaveResult } from '../shared/types';
import { documentText, parseDocument } from './document';
import { pageStateHash, type PageState } from './hash';
import type { KnowledgeDatabase } from './schema';

type PageDatabase = KnowledgeDatabase & EntitiesDatabase;

export interface LockedPage {
  entityId: string;
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
  deleted_at: Date | null;
}

function dbOf(tx: ReadTx) {
  return sqlFor<PageDatabase>(tx);
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

export function createPageWriter(deps: { tree: TreeService; clock: Clock }) {
  const { tree, clock } = deps;

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
      return { status: 'saved', version, savedAt: now.toISOString() };
    },
  };
}
