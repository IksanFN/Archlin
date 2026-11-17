import { ownerOf, sqlFor } from '@archlin/db/scoped';
import { NotFoundError } from '@archlin/kernel';
import type { Clock, Ids, ReadTx, WriteTx } from '@archlin/kernel';
import type { JSONContent } from '@tiptap/core';
import type { ContextFields, SnapshotReason } from '../shared/inputs';
import { documentAttachmentIds } from './attachment-refs';
import { parseDocument } from './document';
import type { KnowledgeDatabase } from './schema';

export interface PageSnapshot {
  entityId: string;
  version: number;
  title: string;
  content: JSONContent;
  contentText: string;
  contentHash: string;
  noteTypeId: string;
  properties: Record<string, unknown>;
  context: ContextFields;
}

function dbOf(tx: ReadTx) {
  return sqlFor<KnowledgeDatabase>(tx);
}

// The only place that writes kb_page_versions, so every reason stamps last_snapshot_at the same way.
export async function insertVersion(
  tx: WriteTx,
  deps: { ids: Ids; clock: Clock },
  input: { snapshot: PageSnapshot; reason: SnapshotReason; label: string | null },
): Promise<string> {
  const { snapshot } = input;
  const noteType = await dbOf(tx)
    .selectFrom('kb_note_types')
    .select('schema_version')
    .where('id', '=', snapshot.noteTypeId)
    .executeTakeFirst();
  if (!noteType) throw new NotFoundError('note_type_not_found', 'Tipe catatan tidak ditemukan');
  const versionId = deps.ids.uuidv7();
  const now = deps.clock.now();
  await dbOf(tx)
    .insertInto('kb_page_versions')
    .values({
      id: versionId,
      owner_id: ownerOf(tx),
      entity_id: snapshot.entityId,
      version: snapshot.version,
      title: snapshot.title,
      content: JSON.stringify(snapshot.content),
      content_text: snapshot.contentText,
      content_hash: snapshot.contentHash,
      note_type_id: snapshot.noteTypeId,
      note_type_schema_version: noteType.schema_version,
      properties: JSON.stringify(snapshot.properties),
      summary: snapshot.context.summary,
      when_to_use: snapshot.context.whenToUse,
      source: snapshot.context.source,
      aliases: [...snapshot.context.aliases],
      reason: input.reason,
      label: input.label,
      // Kept per version so an attachment an old version shows is never treated as an orphan while that version exists.
      attachment_ids: documentAttachmentIds(parseDocument(snapshot.content)),
      created_at: now,
    })
    .execute();
  await dbOf(tx)
    .updateTable('kb_pages')
    .set({ last_snapshot_at: now })
    .where('entity_id', '=', snapshot.entityId)
    .execute();
  return versionId;
}

export async function latestVersion(
  tx: ReadTx,
  entityId: string,
): Promise<{ id: string; contentHash: string; reason: SnapshotReason; label: string | null } | null> {
  const row = await dbOf(tx)
    .selectFrom('kb_page_versions')
    .select(['id', 'content_hash', 'reason', 'label'])
    .where('entity_id', '=', entityId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? { id: row.id, contentHash: row.content_hash, reason: row.reason, label: row.label } : null;
}

export async function latestSnapshotHash(tx: ReadTx, entityId: string): Promise<string | null> {
  return (await latestVersion(tx, entityId))?.contentHash ?? null;
}
