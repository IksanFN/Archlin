import { ownerOf, sqlFor } from '@archlin/db/scoped';
import { ConflictError, NotFoundError } from '@archlin/kernel';
import type { Clock, Ids, ReadTx, WriteTx } from '@archlin/kernel';
import type { BlobService, EntitiesDatabase, StagedFile, TreeService } from '@archlin/platform/server';
import { sql } from 'kysely';
import { attachmentKindOf } from '../shared/attachment-kind';
import type { ExtractionStatus } from '../shared/attachment-kind';
import type { AttachmentIdInput, CopyAttachmentsInput, TrashOrphansInput } from '../shared/inputs';
import type { AttachmentView } from '../shared/types';
import { normalizeFilename } from './filename';
import { classifyFile } from './mime';
import { ATTACHMENT_KIND } from './module';
import { pageInTrash } from './page-writer';
import type { KnowledgeDatabase } from './schema';

type AttachmentDatabase = KnowledgeDatabase & EntitiesDatabase;

export interface AttachmentFile {
  id: string;
  sha256: string;
  filename: string;
  mime: string;
  kind: AttachmentView['kind'];
  size: number;
}

export interface RegisterAttachmentInput {
  pageId: string;
  uploadId: string;
  filename: string;
  declaredMime: string | null;
  staged: StagedFile;
}

export interface AttachmentService {
  register(tx: WriteTx, input: RegisterAttachmentInput): Promise<{ attachment: AttachmentView; created: boolean }>;
  listForPage(tx: ReadTx, pageId: string): Promise<AttachmentView[]>;
  file(tx: ReadTx, attachmentId: string): Promise<AttachmentFile>;
  trashOrphans(tx: WriteTx, input: TrashOrphansInput): Promise<{ trashed: number }>;
  retryExtraction(tx: WriteTx, input: AttachmentIdInput): Promise<AttachmentView>;
  copyToPage(tx: WriteTx, input: CopyAttachmentsInput): Promise<Record<string, string>>;
}

interface ViewRow {
  id: string;
  page_id: string;
  filename: string;
  mime: string;
  size: number;
  extraction_status: ExtractionStatus;
  created_at: Date;
  trashed: boolean;
  referenced: boolean;
}

function dbOf(tx: ReadTx) {
  return sqlFor<AttachmentDatabase>(tx);
}

const attachmentNotFound = () => new NotFoundError('attachment_not_found', 'Lampiran tidak ditemukan');
const pageNotFound = () => new NotFoundError('page_not_found', 'Halaman tidak ditemukan');
const uploadConflict = () => new ConflictError('upload_conflict', 'Unggahan ini sudah dipakai untuk file lain');

function toView(row: ViewRow): AttachmentView {
  return {
    id: row.id,
    pageId: row.page_id,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    kind: attachmentKindOf(row.mime),
    extraction: row.extraction_status,
    referenced: row.referenced,
    trashed: row.trashed,
    createdAt: row.created_at.toISOString(),
  };
}

// "Referenced" is the one definition of what keeps an attachment out of the orphan cleanup: the live content of any live
// page, or any retained version of any page.
const VIEW_SELECT = sql`
  select a.entity_id as id, e.parent_id as page_id, a.filename, a.mime, a.size::float8 as size,
         a.extraction_status, a.created_at, (e.deleted_at is not null) as trashed,
         (
           exists (
             select 1 from kb_attachment_refs r
             inner join entities pe on pe.owner_id = r.owner_id and pe.id = r.page_id
             where r.attachment_id = a.entity_id and pe.deleted_at is null
           )
           or exists (select 1 from kb_page_versions v where v.attachment_ids @> array[a.entity_id])
         ) as referenced
  from kb_attachments a
  inner join entities e on e.owner_id = a.owner_id and e.id = a.entity_id`;

export function createAttachmentService(deps: { tree: TreeService; blobs: BlobService; clock: Clock; ids: Ids }): AttachmentService {
  const { tree, blobs, clock, ids } = deps;

  async function viewsOf(tx: ReadTx, attachmentIds: readonly string[]): Promise<AttachmentView[]> {
    const { rows } = await sql<ViewRow>`${VIEW_SELECT} where a.entity_id = any(${[...attachmentIds]}::uuid[])`.execute(dbOf(tx));
    return rows.map(toView);
  }

  async function viewOf(tx: ReadTx, attachmentId: string): Promise<AttachmentView> {
    const [view] = await viewsOf(tx, [attachmentId]);
    if (!view) throw attachmentNotFound();
    return view;
  }

  async function requireLivePage(tx: ReadTx, pageId: string): Promise<{ spaceId: string }> {
    const { rows } = await sql<{ space_id: string; deleted_at: Date | null }>`
      select e.space_id, e.deleted_at from kb_pages p
      inner join entities e on e.owner_id = p.owner_id and e.id = p.entity_id
      where p.entity_id = ${pageId}`.execute(dbOf(tx));
    const page = rows[0];
    if (!page) throw pageNotFound();
    if (page.deleted_at !== null) pageInTrash();
    return { spaceId: page.space_id };
  }

  return {
    async register(tx, input) {
      // The blob lock comes first and the tree lock inside tree.create comes after, the order everything else keeps.
      const blob = await blobs.register(tx, input.staged);
      const trx = dbOf(tx);

      const { rows: known } = await sql<{ id: string; page_id: string; blob_sha256: string }>`
        select a.entity_id as id, e.parent_id as page_id, a.blob_sha256
        from kb_attachments a inner join entities e on e.owner_id = a.owner_id and e.id = a.entity_id
        where a.upload_id = ${input.uploadId}`.execute(trx);
      const existing = known[0];
      if (existing) {
        if (existing.page_id !== input.pageId || existing.blob_sha256 !== blob.sha256) throw uploadConflict();
        return { attachment: await viewOf(tx, existing.id), created: false };
      }

      const page = await requireLivePage(tx, input.pageId);
      const filename = normalizeFilename(input.filename);
      const classification = await classifyFile({ head: input.staged.head, declaredMime: input.declaredMime });
      const entity = await tree.create(tx, {
        kind: ATTACHMENT_KIND,
        spaceId: page.spaceId,
        parentId: input.pageId,
        title: filename,
        icon: null,
        placement: 'last',
      });
      await trx
        .insertInto('kb_attachments')
        .values({
          owner_id: ownerOf(tx),
          entity_id: entity.id,
          blob_sha256: blob.sha256,
          upload_id: input.uploadId,
          filename,
          mime: classification.mime,
          size: blob.size,
          extraction_status: classification.extractable ? 'pending' : 'unsupported',
          extraction_error: null,
          extracted_text: null,
          extraction_lease_until: null,
          created_at: clock.now(),
        })
        .execute();
      return { attachment: await viewOf(tx, entity.id), created: true };
    },

    async listForPage(tx, pageId) {
      const { rows } = await sql<ViewRow>`${VIEW_SELECT}
        where (e.parent_id = ${pageId} and e.deleted_at is null)
           or exists (select 1 from kb_attachment_refs r where r.page_id = ${pageId} and r.attachment_id = a.entity_id)
        order by a.created_at, a.entity_id`.execute(dbOf(tx));
      return rows.map(toView);
    },

    async file(tx, attachmentId) {
      const { rows } = await sql<{ blob_sha256: string; filename: string; mime: string; size: number }>`
        select blob_sha256, filename, mime, size::float8 as size from kb_attachments where entity_id = ${attachmentId}`.execute(dbOf(tx));
      const row = rows[0];
      if (!row) throw attachmentNotFound();
      return {
        id: attachmentId,
        sha256: row.blob_sha256,
        filename: row.filename,
        mime: row.mime,
        kind: attachmentKindOf(row.mime),
        size: row.size,
      };
    },

    async trashOrphans(tx, input) {
      // The page row lock serializes this with a save, so a reference added a moment ago is seen below.
      const { rows } = await sql<{ entity_id: string }>`select entity_id from kb_pages where entity_id = ${input.pageId} for update`.execute(dbOf(tx));
      if (rows.length === 0) throw pageNotFound();
      const orphans = (await viewsOf(tx, input.attachmentIds)).filter(
        (view) => view.pageId === input.pageId && !view.trashed && !view.referenced,
      );
      for (const orphan of orphans) await tree.trash(tx, orphan.id);
      return { trashed: orphans.length };
    },

    async retryExtraction(tx, input) {
      await sql`update kb_attachments
                set extraction_status = 'pending', extraction_error = null, extraction_attempts = 0, extraction_lease_until = null
                where entity_id = ${input.attachmentId} and extraction_status = 'failed'`.execute(dbOf(tx));
      return viewOf(tx, input.attachmentId);
    },

    async copyToPage(tx, input) {
      await blobs.lock(tx);
      const page = await requireLivePage(tx, input.pageId);
      const { rows } = await sql<{
        id: string;
        parent_id: string | null;
        blob_sha256: string;
        filename: string;
        mime: string;
        size: number;
        extraction_status: ExtractionStatus;
        extraction_error: string | null;
        extracted_text: string | null;
      }>`
        select a.entity_id as id, e.parent_id, a.blob_sha256, a.filename, a.mime, a.size::float8 as size,
               a.extraction_status, a.extraction_error, a.extracted_text
        from kb_attachments a inner join entities e on e.owner_id = a.owner_id and e.id = a.entity_id
        where a.entity_id = any(${[...input.attachmentIds]}::uuid[])`.execute(dbOf(tx));
      const sources = new Map(rows.map((row) => [row.id, row]));

      const copies: Record<string, string> = {};
      for (const sourceId of input.attachmentIds) {
        const source = sources.get(sourceId);
        if (!source || source.parent_id === input.pageId || sourceId in copies) continue;
        const entity = await tree.create(tx, {
          kind: ATTACHMENT_KIND,
          spaceId: page.spaceId,
          parentId: input.pageId,
          title: source.filename,
          icon: null,
          placement: 'last',
        });
        // A fresh upload id and attempt count: the copy is its own attachment, only the bytes and the result are shared.
        await sql`insert into kb_attachments (
                    owner_id, entity_id, blob_sha256, upload_id, filename, mime, size, extraction_status,
                    extraction_error, extracted_text, extraction_attempts, extraction_lease_until, created_at
                  ) values (
                    ${ownerOf(tx)}, ${entity.id}, ${source.blob_sha256}, ${ids.uuidv7()}, ${source.filename}, ${source.mime},
                    ${source.size}, ${source.extraction_status}, ${source.extraction_error}, ${source.extracted_text}, 0, null, ${clock.now()}
                  )`.execute(dbOf(tx));
        copies[sourceId] = entity.id;
      }
      return copies;
    },
  };
}
