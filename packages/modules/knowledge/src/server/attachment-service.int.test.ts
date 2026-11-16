import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { sqlFor } from '@archlin/db/scoped';
import { buildRegistry, systemIds } from '@archlin/kernel';
import type { ReadTx, WriteTx } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { blobKey } from '@archlin/platform/contracts';
import {
  PLATFORM_EVENTS,
  createBlobService,
  createEventPublisher,
  createLinkService,
  createSpaceService,
  createTagService,
  createTreeService,
} from '@archlin/platform/server';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { createInMemoryStorage, FakeClock, SequenceIds } from '@archlin/testing/fakes';
import { fixtureMigrations } from '@archlin/testing/fixture-module';
import { PNG_BYTES, pdfFixture } from '@archlin/testing/files';
import type { JSONContent } from '@tiptap/core';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { knowledgeMigrations } from '../migrations';
import { createKnowledgeApi } from './api';
import { createKnowledgeModule } from './module';
import type { KnowledgeDatabase } from './schema';
import { seedSystemNoteTypes } from './seed';

const NOW = new Date('2026-11-16T00:00:00.000Z');
const HOUR = 3_600_000;
const EMPTY_CONTEXT = { summary: null, whenToUse: null, source: null, aliases: [] as string[] };

const registry = buildRegistry([createKnowledgeModule({ ids: systemIds })], PLATFORM_EVENTS);
const clock = new FakeClock(NOW);
const ids = new SequenceIds();
const storage = createInMemoryStorage(clock);
const publisher = createEventPublisher({ registry, ids: systemIds, clock });
const spaces = createSpaceService({ registry, ids: systemIds, clock });
const tree = createTreeService({ registry, publisher, clock, ids: systemIds });
const tags = createTagService({ tree, ids: systemIds, clock });
const links = createLinkService({ registry, ids: systemIds, clock });
const blobs = createBlobService({ registry, files: storage, clock });
const api = createKnowledgeApi({ tree, tags, links, publisher, clock, ids, blobs });
const attachments = api.attachments;

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;
let spaceId: string;
let quickNoteId: string;

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations, knowledgeMigrations] }));
  db = createDatabase({ connectionString: urls.app, applicationName: 'attachment-service-test', max: 4 });
  uow = createOwnerUnitOfWork(db);
  for (const owner of [ownerA, ownerB]) {
    await uow.write(issueOwnerScope(owner), (tx) => seedSystemNoteTypes(sqlFor<KnowledgeDatabase>(tx), owner, systemIds, NOW));
  }
});

afterAll(async () => {
  await db.destroy();
});

const write = <T>(work: (tx: WriteTx) => Promise<T>) => uow.write(issueOwnerScope(ownerA), work);
const read = <T>(work: (tx: ReadTx) => Promise<T>) => uow.read(issueOwnerScope(ownerA), work);
const readAs = <T>(owner: string, work: (tx: ReadTx) => Promise<T>) => uow.read(issueOwnerScope(owner), work);

const withMigrator = async <T>(work: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

beforeEach(async () => {
  clock.set(NOW);
  await withMigrator(async (client) => {
    await client.query('DELETE FROM public.entities');
    await client.query('DELETE FROM public.spaces');
    await client.query('DELETE FROM public.blobs');
  });
  spaceId = (await write((tx) => spaces.create(tx, { name: 'Basis', icon: null }))).id;
  quickNoteId = await read(async (tx) => {
    const row = await sqlFor<KnowledgeDatabase>(tx).selectFrom('kb_note_types').select('id').where('key', '=', 'quick_note').executeTakeFirstOrThrow();
    return row.id;
  });
});

interface PageRef {
  entityId: string;
}

const createPageTitled = (title: string, inSpace = spaceId, parentId: string | null = null) =>
  write((tx) => api.pages.createPage(tx, { spaceId: inSpace, parentId, noteTypeId: quickNoteId, placement: 'last', title }));

const stage = (bytes: Uint8Array) =>
  storage.stage(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    { maxBytes: 52_428_800 },
  );

const register = (page: PageRef, bytes: Uint8Array, filename: string, uploadId: string = ids.uuidv7(), declaredMime: string | null = null) =>
  write(async (tx) => attachments.register(tx, { pageId: page.entityId, uploadId, filename, declaredMime, staged: await stage(bytes) }));

const list = (page: PageRef) => read((tx) => attachments.listForPage(tx, page.entityId));
const pageVersionOf = async (page: PageRef) => (await read((tx) => api.pages.getPage(tx, page.entityId))).version;

const save = async (page: PageRef, content: JSONContent) => {
  const view = await read((tx) => api.pages.getPage(tx, page.entityId));
  return write((tx) =>
    api.pages.savePage(tx, {
      entityId: page.entityId,
      baseVersion: view.version,
      title: view.title,
      content,
      context: EMPTY_CONTEXT,
      properties: {},
    }),
  );
};

const snapshot = (page: PageRef, reason: 'manual' | 'leave', label: string | null) =>
  write((tx) => api.versions.snapshot(tx, { entityId: page.entityId, reason, label }));
const restore = (page: PageRef, versionId: string, baseVersion: number) =>
  write((tx) => api.versions.restore(tx, { entityId: page.entityId, versionId, baseVersion }));

const para = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const docText = (text: string): JSONContent => ({ type: 'doc', content: [para(text)] });
const docWith = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: [para('isi'), ...blocks] });
const attachmentBlock = (id: string): JSONContent => ({ type: 'attachment', attrs: { attachmentId: id } });
const imageNode = (id: string): JSONContent => ({ type: 'image', attrs: { src: `/files/${id}`, attachmentId: id } });

const countRows = (table: string) =>
  withMigrator(async (client) => Number((await client.query(`SELECT count(*) AS n FROM public.${table}`)).rows[0].n));

const setExtraction = (
  id: string,
  values: { status?: string; error?: string | null; attempts?: number; leaseUntil?: Date | null },
) =>
  write(async (tx) => {
    await sql`update kb_attachments set
        extraction_status = coalesce(${values.status ?? null}::text, extraction_status),
        extraction_error = case when ${values.status !== undefined}::boolean then ${values.error ?? null}::text else extraction_error end,
        extraction_attempts = coalesce(${values.attempts ?? null}::int, extraction_attempts),
        extraction_lease_until = case when ${values.leaseUntil !== undefined}::boolean then ${values.leaseUntil ?? null}::timestamptz else extraction_lease_until end
      where entity_id = ${id}`.execute(sqlFor(tx));
  });
const extractionOf = (id: string) =>
  read(async (tx) => {
    const { rows } = await sql<{ status: string; error: string | null; attempts: number; text: string | null; lease: Date | null }>`
      select extraction_status as status, extraction_error as error, extraction_attempts as attempts,
             extracted_text as text, extraction_lease_until as lease
      from kb_attachments where entity_id = ${id}`.execute(sqlFor(tx));
    const row = rows[0];
    if (!row) throw new Error('attachment row missing');
    return row;
  });

describe('AttachmentService', () => {
  it('register creates an attachment entity under the page with a pending extraction for a pdf', async () => {
    const page = await createPageTitled('Laporan');
    const { attachment, created } = await register(page, pdfFixture('Halo'), 'laporan.pdf');
    expect(created).toBe(true);
    expect(attachment).toMatchObject({ pageId: page.entityId, kind: 'pdf', extraction: 'pending', referenced: false, trashed: false });
    expect((await read((tx) => tree.get(tx, attachment.id))).parentId).toBe(page.entityId);
    expect(attachment.filename).toBe('laporan.pdf');
  });

  it('an image is stored as an image and is never extracted', async () => {
    const page = await createPageTitled('Laporan');
    const { attachment } = await register(page, PNG_BYTES, 'grafik.png');
    expect(attachment).toMatchObject({ kind: 'image', mime: 'image/png', extraction: 'unsupported' });
  });

  it('plain text declared by the client is extractable only when the bytes are utf-8', async () => {
    const page = await createPageTitled('Laporan');
    const text = await register(page, new TextEncoder().encode('halo'), 'a.txt', ids.uuidv7(), 'text/plain');
    const binary = await register(page, Uint8Array.of(0xff, 0xfe, 0x00), 'b.txt', ids.uuidv7(), 'text/plain');
    expect(text.attachment).toMatchObject({ mime: 'text/plain', extraction: 'pending' });
    expect(binary.attachment).toMatchObject({ mime: 'application/octet-stream', extraction: 'unsupported' });
  });

  it('the stored name is the normalized file name', async () => {
    const page = await createPageTitled('Laporan');
    const { attachment } = await register(page, pdfFixture('Halo'), '../../etc/laporan  akhir.pdf');
    expect(attachment.filename).toBe('laporan akhir.pdf');
  });

  it('registering the same upload id twice returns the first attachment', async () => {
    const page = await createPageTitled('Laporan');
    const uploadId = ids.uuidv7();
    const first = await register(page, pdfFixture('Halo'), 'a.pdf', uploadId);
    const again = await register(page, pdfFixture('Halo'), 'a.pdf', uploadId);
    expect(again).toEqual({ attachment: first.attachment, created: false });
    expect(await countRows('kb_attachments')).toBe(1);
  });

  it('the same upload id with different content is a conflict', async () => {
    const page = await createPageTitled('Laporan');
    const uploadId = ids.uuidv7();
    await register(page, pdfFixture('A'), 'a.pdf', uploadId);
    await expect(register(page, pdfFixture('B'), 'a.pdf', uploadId)).rejects.toMatchObject({ code: 'upload_conflict' });
  });

  it('the same upload id for another page is a conflict', async () => {
    const a = await createPageTitled('A');
    const b = await createPageTitled('B');
    const uploadId = ids.uuidv7();
    await register(a, pdfFixture('Halo'), 'a.pdf', uploadId);
    await expect(register(b, pdfFixture('Halo'), 'a.pdf', uploadId)).rejects.toMatchObject({ code: 'upload_conflict' });
  });

  it('register refuses a page in trash and a page that does not exist', async () => {
    const page = await createPageTitled('Lama');
    await write((tx) => tree.trash(tx, page.entityId));
    await expect(register(page, pdfFixture('Halo'), 'a.pdf')).rejects.toMatchObject({ code: 'page_in_trash' });
    await expect(register({ entityId: ids.uuidv7() }, pdfFixture('Halo'), 'a.pdf')).rejects.toMatchObject({ code: 'page_not_found' });
    expect(await countRows('kb_attachments')).toBe(0);
  });

  it('two pages with the same file share one blob', async () => {
    const a = await createPageTitled('A');
    const b = await createPageTitled('B');
    await register(a, pdfFixture('Sama'), 'a.pdf');
    await register(b, pdfFixture('Sama'), 'b.pdf');
    expect([await countRows('kb_attachments'), await countRows('blobs')]).toEqual([2, 1]);
  });

  it('saving content that references an attachment marks it referenced and removing it makes it an orphan', async () => {
    const page = await createPageTitled('Laporan');
    const { attachment } = await register(page, pdfFixture('Halo'), 'a.pdf');
    await save(page, docWith(attachmentBlock(attachment.id)));
    expect((await list(page))[0]?.referenced).toBe(true);
    await save(page, docText('kosong'));
    expect((await list(page))[0]?.referenced).toBe(false);
  });

  it('an attachment referenced only by a retained version is not an orphan', async () => {
    const page = await createPageTitled('Laporan');
    const { attachment } = await register(page, pdfFixture('Halo'), 'a.pdf');
    await save(page, docWith(attachmentBlock(attachment.id)));
    await snapshot(page, 'manual', null);
    await save(page, docText('kosong'));
    expect((await list(page))[0]?.referenced).toBe(true);
  });

  it('trashOrphans moves only orphans to trash and skips one that is referenced', async () => {
    const page = await createPageTitled('Laporan');
    const orphan = (await register(page, pdfFixture('A'), 'a.pdf')).attachment;
    const used = (await register(page, pdfFixture('B'), 'b.pdf')).attachment;
    await save(page, docWith(attachmentBlock(used.id)));
    expect(await write((tx) => attachments.trashOrphans(tx, { pageId: page.entityId, attachmentIds: [orphan.id, used.id] }))).toEqual({ trashed: 1 });
    expect((await list(page)).map((a) => a.id)).toEqual([used.id]);
    expect((await read((tx) => tree.get(tx, orphan.id))).deletedAt).not.toBeNull();
  });

  it('trashOrphans ignores an attachment that belongs to another page', async () => {
    const a = await createPageTitled('A');
    const b = await createPageTitled('B');
    const foreign = (await register(a, pdfFixture('A'), 'a.pdf')).attachment;
    expect(await write((tx) => attachments.trashOrphans(tx, { pageId: b.entityId, attachmentIds: [foreign.id] }))).toEqual({ trashed: 0 });
    expect((await list(a)).map((x) => x.id)).toEqual([foreign.id]);
  });

  it('restoring an old version after an orphan cleanup shows its attachment again', async () => {
    const page = await createPageTitled('Laporan');
    const { attachment } = await register(page, PNG_BYTES, 'grafik.png');
    await save(page, docWith(imageNode(attachment.id)));
    const old = await snapshot(page, 'manual', null);
    await save(page, docText('tanpa gambar'));
    expect(await write((tx) => attachments.trashOrphans(tx, { pageId: page.entityId, attachmentIds: [attachment.id] }))).toEqual({ trashed: 0 });
    await restore(page, (old as { versionId: string }).versionId, await pageVersionOf(page));
    expect((await list(page)).map((a) => [a.id, a.trashed, a.referenced])).toEqual([[attachment.id, false, true]]);
    const file = await read((tx) => attachments.file(tx, attachment.id));
    expect(await storage.exists(blobKey(ownerA, file.sha256))).toBe(true);
  });

  it('purging a page that shares a blob keeps the other page attachment readable', async () => {
    const a = await createPageTitled('A');
    const b = await createPageTitled('B');
    await register(a, pdfFixture('Sama'), 'a.pdf');
    const kept = (await register(b, pdfFixture('Sama'), 'b.pdf')).attachment;
    await write((tx) => tree.trash(tx, a.entityId));
    await write((tx) => tree.purge(tx, a.entityId));
    clock.advance(72 * HOUR);
    await write((tx) => blobs.collectGarbage(tx));
    await write((tx) => blobs.collectGarbage(tx));
    const file = await read((tx) => attachments.file(tx, kept.id));
    expect(await storage.exists(blobKey(ownerA, file.sha256))).toBe(true);
  });

  it('a blob whose last attachment was purged is collected after the grace period', async () => {
    const page = await createPageTitled('A');
    const { attachment } = await register(page, pdfFixture('Sendiri'), 'a.pdf');
    const file = await read((tx) => attachments.file(tx, attachment.id));
    await write((tx) => tree.trash(tx, page.entityId));
    await write((tx) => tree.purge(tx, page.entityId));
    expect(await countRows('kb_attachments')).toBe(0);
    clock.advance(25 * HOUR);
    await write((tx) => blobs.collectGarbage(tx));
    clock.advance(25 * HOUR);
    expect(await write((tx) => blobs.collectGarbage(tx))).toMatchObject({ deleted: 1 });
    expect(await storage.exists(blobKey(ownerA, file.sha256))).toBe(false);
  });

  it('copyToPage creates a new attachment on the target page with the same blob', async () => {
    const a = await createPageTitled('A');
    const b = await createPageTitled('B');
    const source = (await register(a, pdfFixture('Halo'), 'a.pdf')).attachment;
    const map = await write((tx) => attachments.copyToPage(tx, { pageId: b.entityId, attachmentIds: [source.id] }));
    const copy = (await list(b))[0];
    expect(map).toEqual({ [source.id]: copy?.id });
    expect(copy).toMatchObject({ filename: 'a.pdf', mime: 'application/pdf', pageId: b.entityId });
    expect(await countRows('blobs')).toBe(1);
  });

  it('copyToPage keeps the extraction result and skips ids that are missing or already on the page', async () => {
    const a = await createPageTitled('A');
    const b = await createPageTitled('B');
    const source = (await register(a, pdfFixture('Halo'), 'a.pdf')).attachment;
    await setExtraction(source.id, { status: 'done' });
    const own = (await register(b, pdfFixture('Lain'), 'b.pdf')).attachment;
    const map = await write((tx) =>
      attachments.copyToPage(tx, { pageId: b.entityId, attachmentIds: [source.id, own.id, ids.uuidv7()] }),
    );
    expect(Object.keys(map)).toEqual([source.id]);
    const copyId = map[source.id];
    if (copyId === undefined) throw new Error('missing copy');
    expect(await extractionOf(copyId)).toMatchObject({ status: 'done', attempts: 0, lease: null });
  });

  it('retryExtraction resets a failed attachment to pending', async () => {
    const page = await createPageTitled('Laporan');
    const { attachment } = await register(page, pdfFixture('Halo'), 'a.pdf');
    await setExtraction(attachment.id, { status: 'failed', error: 'timeout', attempts: 3 });
    const view = await write((tx) => attachments.retryExtraction(tx, { attachmentId: attachment.id }));
    expect(view.extraction).toBe('pending');
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'pending', error: null, attempts: 0 });
  });

  it('retryExtraction leaves any other status alone', async () => {
    const page = await createPageTitled('Laporan');
    const { attachment } = await register(page, pdfFixture('Halo'), 'a.pdf');
    await setExtraction(attachment.id, { status: 'done', attempts: 1 });
    const view = await write((tx) => attachments.retryExtraction(tx, { attachmentId: attachment.id }));
    expect(view.extraction).toBe('done');
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('file answers with the stored name, type and digest', async () => {
    const page = await createPageTitled('Laporan');
    const { attachment } = await register(page, pdfFixture('Halo'), 'laporan.pdf');
    const file = await read((tx) => attachments.file(tx, attachment.id));
    expect(file).toMatchObject({ id: attachment.id, filename: 'laporan.pdf', mime: 'application/pdf', kind: 'pdf', size: attachment.size });
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('owner B cannot read owner A attachments', async () => {
    const page = await createPageTitled('Laporan');
    const { attachment } = await register(page, pdfFixture('Halo'), 'a.pdf');
    await expect(readAs(ownerB, (tx) => attachments.file(tx, attachment.id))).rejects.toMatchObject({ code: 'attachment_not_found' });
  });

  it('the page screen lists its own attachments and the ones its content refers to on other pages', async () => {
    const a = await createPageTitled('A');
    const b = await createPageTitled('B');
    const foreign = (await register(a, PNG_BYTES, 'a.png')).attachment;
    const own = (await register(b, pdfFixture('Halo'), 'b.pdf')).attachment;
    await save(b, docWith(imageNode(foreign.id)));
    const screen = await write((tx) => api.pages.screen(tx, { entityId: b.entityId, recordView: false }));
    expect(screen.attachments.map((x) => [x.id, x.referenced]).sort()).toEqual([[foreign.id, true], [own.id, false]].sort());
  });

  it('an attachment trashed with its page still shows as trashed where another page refers to it', async () => {
    const a = await createPageTitled('A');
    const b = await createPageTitled('B');
    const foreign = (await register(a, PNG_BYTES, 'a.png')).attachment;
    await save(b, docWith(imageNode(foreign.id)));
    await write((tx) => tree.trash(tx, a.entityId));
    expect((await list(b)).map((x) => [x.id, x.trashed])).toEqual([[foreign.id, true]]);
  });

  it('an attachment never shows up in the tree under its page', async () => {
    const page = await createPageTitled('Laporan');
    const { attachment } = await register(page, pdfFixture('Halo'), 'a.pdf');
    expect((await read((tx) => tree.get(tx, attachment.id))).kind).toBe('kb.attachment');
    expect(await read((tx) => tree.children(tx, { spaceId, parentId: page.entityId }))).toEqual([]);
  });

});
