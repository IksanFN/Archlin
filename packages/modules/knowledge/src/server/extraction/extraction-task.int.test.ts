import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { sqlFor } from '@archlin/db/scoped';
import { buildRegistry, defineHandler, defineModule, systemIds } from '@archlin/kernel';
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
  entityUpdated,
} from '@archlin/platform/server';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { createInMemoryStorage, FakeClock, noopLogger, SequenceIds } from '@archlin/testing/fakes';
import { fixtureMigrations } from '@archlin/testing/fixture-module';
import { pdfFixture, utf8 } from '@archlin/testing/files';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { knowledgeMigrations } from '../../migrations';
import { createKnowledgeApi } from '../api';
import { createKnowledgeModule } from '../module';
import type { KnowledgeDatabase } from '../schema';
import { seedSystemNoteTypes } from '../seed';
import { extractText, EXTRACTION_LIMITS } from './extractors';
import type { ExtractionRunner } from './runner';
import { createAttachmentExtractionTask } from './extraction-task';

const NOW = new Date('2026-11-16T00:00:00.000Z');

// A module that listens to entity.updated, because the outbox only keeps events somebody handles asynchronously.
const probe = defineModule({
  id: 'probe',
  eventHandlers: [defineHandler({ id: 'seen', event: entityUpdated, mode: 'async', handle: async () => undefined })],
});
const registry = buildRegistry([createKnowledgeModule({ ids: systemIds }), probe], PLATFORM_EVENTS);
const clock = new FakeClock(NOW);
const ids = new SequenceIds();
const storage = createInMemoryStorage(clock);
const publisher = createEventPublisher({ registry, ids: systemIds, clock });
const spaces = createSpaceService({ registry, ids: systemIds, clock });
const tree = createTreeService({ registry, publisher, clock, ids: systemIds });
const tags = createTagService({ tree, ids: systemIds, clock });
const links = createLinkService({ registry, ids: systemIds, clock });
const blobs = createBlobService({ registry, files: storage, clock });
const api = createKnowledgeApi({ tree, tags, links, blobs, publisher, clock, ids });

const bytesOf = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
};
const inProcessRunner: ExtractionRunner = {
  run: async ({ mime, bytes }) => extractText(await bytesOf(bytes), mime, { maxChars: EXTRACTION_LIMITS.maxChars }),
};

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;
let page: { entityId: string };
let signal: AbortSignal;

const ownerScope = () => issueOwnerScope(ownerA);
const taskDeps = () => ({ uow, clock, files: storage, tree, runner: inProcessRunner, logger: noopLogger });
const task = () => createAttachmentExtractionTask(taskDeps());

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations, knowledgeMigrations] }));
  db = createDatabase({ connectionString: urls.app, applicationName: 'extraction-task-test', max: 4 });
  uow = createOwnerUnitOfWork(db);
  signal = new AbortController().signal;
  for (const owner of [ownerA, ownerB]) {
    await uow.write(issueOwnerScope(owner), (tx) => seedSystemNoteTypes(sqlFor<KnowledgeDatabase>(tx), owner, systemIds, NOW));
  }
});

afterAll(async () => {
  await db.destroy();
});

const write = <T>(work: (tx: WriteTx) => Promise<T>) => uow.write(ownerScope(), work);
const read = <T>(work: (tx: ReadTx) => Promise<T>) => uow.read(ownerScope(), work);

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
    await client.query('DELETE FROM public.outbox_events');
  });
  const space = await write((tx) => spaces.create(tx, { name: 'Basis', icon: null }));
  const quickNote = await read((tx) =>
    sqlFor<KnowledgeDatabase>(tx).selectFrom('kb_note_types').select('id').where('key', '=', 'quick_note').executeTakeFirstOrThrow(),
  );
  page = await write((tx) =>
    api.pages.createPage(tx, { spaceId: space.id, parentId: null, noteTypeId: quickNote.id, placement: 'last', title: 'Laporan' }),
  );
});

const register = (bytes: Uint8Array, filename: string, declaredMime: string | null = null) =>
  write(async (tx) =>
    api.attachments.register(tx, {
      pageId: page.entityId,
      uploadId: ids.uuidv7(),
      filename,
      declaredMime,
      staged: await storage.stage(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        { maxBytes: 52_428_800 },
      ),
    }),
  );

const setExtraction = (id: string, leaseUntil: Date | null) =>
  write(async (tx) => {
    await sql`update kb_attachments set extraction_lease_until = ${leaseUntil} where entity_id = ${id}`.execute(sqlFor(tx));
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
const outboxFields = () =>
  withMigrator(async (client) =>
    (await client.query(`SELECT payload FROM public.outbox_events WHERE type = 'entity.updated'`)).rows.map(
      (row) => (row.payload as { fields: string[] }).fields,
    ),
  );

describe('attachment extraction task', () => {
  it('a pending pdf becomes done with its text and publishes entity.updated', async () => {
    const { attachment } = await register(pdfFixture('Rollback Postgres'), 'r.pdf');
    await task().run(ownerScope(), signal);
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'done', text: 'Rollback Postgres', attempts: 1, lease: null });
    expect(await outboxFields()).toContainEqual(['extractedText']);
  });

  it('a scanned pdf becomes no_text', async () => {
    const { attachment } = await register(pdfFixture(null), 'scan.pdf');
    await task().run(ownerScope(), signal);
    expect((await extractionOf(attachment.id)).status).toBe('no_text');
  });

  it('a corrupt file fails with corrupt and is not tried again', async () => {
    const { attachment } = await register(pdfFixture('Halo'), 'rusak.pdf');
    const corrupt = createAttachmentExtractionTask({ ...taskDeps(), runner: { run: async () => ({ status: 'failed', error: 'corrupt' }) } });
    await corrupt.run(ownerScope(), signal);
    await corrupt.run(ownerScope(), signal);
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'failed', error: 'corrupt', attempts: 1 });
  });

  it('a missing blob fails with blob_missing', async () => {
    const { attachment } = await register(pdfFixture('Halo'), 'a.pdf');
    const file = await read((tx) => api.attachments.file(tx, attachment.id));
    await storage.delete(blobKey(ownerA, file.sha256));
    await task().run(ownerScope(), signal);
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'failed', error: 'blob_missing' });
  });

  it('a timeout is retried until the third attempt then fails', async () => {
    const timeoutTask = createAttachmentExtractionTask({
      ...taskDeps(),
      runner: { run: async () => ({ status: 'failed', error: 'timeout' }) },
    });
    const { attachment } = await register(pdfFixture('Halo'), 'a.pdf');
    const statuses: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await timeoutTask.run(ownerScope(), signal);
      statuses.push((await extractionOf(attachment.id)).status);
      clock.advance(EXTRACTION_LIMITS.leaseMs + 1);
    }
    expect(statuses).toEqual(['pending', 'pending', 'failed']);
    expect(await extractionOf(attachment.id)).toMatchObject({ error: 'timeout', attempts: 3 });
  });

  it('a result for a lease that expired and was claimed again is discarded', async () => {
    const { attachment } = await register(pdfFixture('Halo'), 'a.pdf');
    let release!: () => void;
    const slowTask = createAttachmentExtractionTask({
      ...taskDeps(),
      runner: {
        run: () =>
          new Promise((resolve) => {
            release = () => resolve({ status: 'done', text: 'lama' });
          }),
      },
    });
    const running = slowTask.run(ownerScope(), signal);
    await expect.poll(() => typeof release).toBe('function');
    await setExtraction(attachment.id, new Date(clock.now().getTime() + 999_000));
    release();
    await running;
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'pending', text: null });
  });

  it('an attachment whose lease is still valid is left to the process that holds it', async () => {
    const { attachment } = await register(pdfFixture('Halo'), 'a.pdf');
    await setExtraction(attachment.id, new Date(clock.now().getTime() + 60_000));
    await task().run(ownerScope(), signal);
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('files that cannot be extracted are never claimed', async () => {
    const { attachment } = await register(utf8('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'g.svg', 'image/svg+xml');
    await task().run(ownerScope(), signal);
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'unsupported', attempts: 0 });
  });

  it('an attachment in trash is not extracted', async () => {
    const { attachment } = await register(pdfFixture('Halo'), 'a.pdf');
    await write((tx) => tree.trash(tx, attachment.id));
    await task().run(ownerScope(), signal);
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('a result for an attachment trashed meanwhile is stored without an event', async () => {
    const { attachment } = await register(pdfFixture('Halo'), 'a.pdf');
    const trashing = createAttachmentExtractionTask({
      ...taskDeps(),
      runner: {
        run: async () => {
          await write((tx) => tree.trash(tx, attachment.id));
          return { status: 'done', text: 'tersimpan' };
        },
      },
    });
    await trashing.run(ownerScope(), signal);
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'done', text: 'tersimpan' });
    expect(await outboxFields()).not.toContainEqual(['extractedText']);
  });

  it('handles at most five attachments per round and each only once', async () => {
    const created = [];
    for (let i = 0; i < 7; i += 1) created.push((await register(pdfFixture(`Isi ${i}`), `a${i}.pdf`)).attachment.id);
    await task().run(ownerScope(), signal);
    const statuses = await Promise.all(created.map(async (id) => (await extractionOf(id)).status));
    expect(statuses.filter((status) => status === 'done')).toHaveLength(5);
    await task().run(ownerScope(), signal);
    expect(await Promise.all(created.map(async (id) => (await extractionOf(id)).status))).toEqual(Array(7).fill('done'));
  });

  it('only extracts attachments of the owner it runs for', async () => {
    const { attachment } = await register(pdfFixture('Halo'), 'a.pdf');
    await task().run(issueOwnerScope(ownerB), signal);
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('a runner that is aborted rejects and leaves the claim for the next round', async () => {
    const { attachment } = await register(pdfFixture('Halo'), 'a.pdf');
    const aborted = createAttachmentExtractionTask({
      ...taskDeps(),
      runner: {
        run: async () => {
          throw new DOMException('aborted', 'AbortError');
        },
      },
    });
    await expect(aborted.run(ownerScope(), signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(await extractionOf(attachment.id)).toMatchObject({ status: 'pending', attempts: 1 });
    clock.advance(EXTRACTION_LIMITS.leaseMs + 1);
    await task().run(ownerScope(), signal);
    expect((await extractionOf(attachment.id)).status).toBe('done');
  });
});
