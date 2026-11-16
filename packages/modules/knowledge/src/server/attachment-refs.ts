import { ownerOf, sqlFor } from '@archlin/db/scoped';
import type { WriteTx } from '@archlin/kernel';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { sql } from 'kysely';
import type { KnowledgeDatabase } from './schema';

// Every attachment the document shows or links, once, in the order it first appears.
export function documentAttachmentIds(doc: ProseMirrorNode): string[] {
  const found = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name !== 'image' && node.type.name !== 'attachment') return;
    const id: unknown = node.attrs.attachmentId;
    if (typeof id === 'string') found.add(id);
  });
  return [...found];
}

// Keeps the rows that still match so an autosave that did not touch attachments writes nothing. An id that has no
// attachment row (a legacy or foreign node) is skipped: the document keeps it and the page shows "not available".
export async function syncAttachmentRefs(tx: WriteTx, pageId: string, attachmentIds: readonly string[]): Promise<void> {
  const trx = sqlFor<KnowledgeDatabase>(tx);
  const wanted = [...attachmentIds];
  await sql`delete from kb_attachment_refs where page_id = ${pageId} and attachment_id <> all(${wanted}::uuid[])`.execute(trx);
  if (wanted.length === 0) return;
  await sql`insert into kb_attachment_refs (owner_id, page_id, attachment_id)
            select ${ownerOf(tx)}, ${pageId}, a.entity_id from kb_attachments a where a.entity_id = any(${wanted}::uuid[])
            on conflict do nothing`.execute(trx);
}
