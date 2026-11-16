import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { buildRegistry } from '@archlin/kernel';
import type { WriteTx } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { createInMemoryStorage, FakeClock, noopLogger } from '@archlin/testing/fakes';
import { fixtureMigrations, fixtureModule } from '@archlin/testing/fixture-module';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blobKey } from '../../contracts';
import { PLATFORM_EVENTS } from '../platform-events';
import { BLOB_GC_GRACE_MS, createBlobMaintenanceTask, createBlobService } from './blob-service';
import type { FileStorage } from './file-storage';

const HOUR = 3_600_000;
const registry = buildRegistry([fixtureModule], PLATFORM_EVENTS);

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;
let clock: FakeClock;
let storage: FileStorage;
let blobs: ReturnType<typeof createBlobService>;

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations] }));
  db = createDatabase({ connectionString: urls.app, applicationName: 'blob-service-test', max: 4 });
  uow = createOwnerUnitOfWork(db);
});

afterAll(async () => {
  await db.destroy();
});

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
  await withMigrator(async (client) => {
    await client.query('DELETE FROM public.fixture_files');
    await client.query('DELETE FROM public.blobs');
  });
  clock = new FakeClock(new Date('2026-11-16T00:00:00.000Z'));
  storage = createInMemoryStorage(clock);
  blobs = createBlobService({ registry, files: storage, clock });
});

const write = <T>(work: (tx: WriteTx) => Promise<T>) => uow.write(issueOwnerScope(ownerA), work);
const writeAs = <T>(owner: string, work: (tx: WriteTx) => Promise<T>) => uow.write(issueOwnerScope(owner), work);

const stage = (text: string) =>
  storage.stage(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    { maxBytes: 1000 },
  );
const register = (text: string) =>
  write(async (tx) => blobs.register(tx, await stage(text)));
const gc = () => write((tx) => blobs.collectGarbage(tx));
const countRows = (table: string) =>
  withMigrator(async (client) => Number((await client.query(`SELECT count(*) AS n FROM public.${table}`)).rows[0].n));
const referenceFromFixture = (sha256: string) =>
  withMigrator((client) =>
    client.query('INSERT INTO public.fixture_files (owner_id, blob_sha256) VALUES ($1, $2)', [ownerA, sha256]),
  );

describe('BlobService', () => {
  it('register publishes a new blob once and a second identical upload reuses it', async () => {
    const first = await register('isi');
    const second = await register('isi');
    expect(second).toEqual(first);
    expect(await countRows('blobs')).toBe(1);
    expect(await storage.sweepStaging(new Date(clock.now().getTime() + 1))).toBe(0);
    expect(await storage.exists(blobKey(ownerA, first.sha256))).toBe(true);
  });

  it('concurrent registers of the same content serialize on the blob lock', async () => {
    const [a, b] = await Promise.all([register('sama'), register('sama')]);
    expect(a.sha256).toBe(b.sha256);
    expect(await countRows('blobs')).toBe(1);
    expect(await storage.exists(blobKey(ownerA, a.sha256))).toBe(true);
    expect(await storage.sweepStaging(new Date(clock.now().getTime() + 1))).toBe(0);
  });

  it('garbage collection deletes a blob only after it stayed unreferenced for a day after marking', async () => {
    const blob = await register('yatim');
    clock.advance(25 * HOUR);
    expect(await gc()).toMatchObject({ marked: 1, deleted: 0 });
    clock.advance(23 * HOUR);
    expect(await gc()).toMatchObject({ deleted: 0 });
    clock.advance(2 * HOUR);
    expect(await gc()).toMatchObject({ deleted: 1 });
    expect(await storage.exists(blobKey(ownerA, blob.sha256))).toBe(false);
    expect(await countRows('blobs')).toBe(0);
  });

  it('a blob younger than the grace period is not marked', async () => {
    await register('baru');
    clock.advance(23 * HOUR);
    expect(await gc()).toEqual({ marked: 0, unmarked: 0, deleted: 0 });
  });

  it('a referenced blob is never marked and a reference that appears after marking unmarks it', async () => {
    const kept = await register('dirujuk');
    await referenceFromFixture(kept.sha256);
    const late = await register('nanti');
    clock.advance(25 * HOUR);
    expect(await gc()).toMatchObject({ marked: 1 });
    await referenceFromFixture(late.sha256);
    expect(await gc()).toMatchObject({ unmarked: 1, deleted: 0 });
    clock.advance(50 * HOUR);
    expect(await gc()).toMatchObject({ deleted: 0 });
    expect(await storage.exists(blobKey(ownerA, late.sha256))).toBe(true);
  });

  it('registering a marked blob again clears the mark so it survives the next collection', async () => {
    const blob = await register('hidup lagi');
    clock.advance(25 * HOUR);
    expect(await gc()).toMatchObject({ marked: 1 });
    await register('hidup lagi');
    clock.advance(25 * HOUR);
    expect(await gc()).toMatchObject({ marked: 1, deleted: 0 });
    expect(await storage.exists(blobKey(ownerA, blob.sha256))).toBe(true);
  });

  it('collectGarbage deletes at most 100 blobs per call', async () => {
    await write(async (tx) => {
      for (let i = 0; i < 101; i += 1) await blobs.register(tx, await stage(`blob ${i}`));
    });
    clock.advance(25 * HOUR);
    await gc();
    clock.advance(25 * HOUR);
    expect(await gc()).toMatchObject({ deleted: 100 });
    expect(await gc()).toMatchObject({ deleted: 1 });
  });

  it('a register after a collection that removed the file publishes it again', async () => {
    const blob = await register('balik');
    await storage.delete(blobKey(ownerA, blob.sha256));
    await register('balik');
    expect(await storage.exists(blobKey(ownerA, blob.sha256))).toBe(true);
  });

  it('sweepOrphanFiles deletes files without a row once they are older than a day', async () => {
    const staged = await stage('tanpa baris');
    await storage.publish(staged, blobKey(ownerA, staged.sha256));
    expect(await write((tx) => blobs.sweepOrphanFiles(tx))).toBe(0);
    clock.advance(25 * HOUR);
    expect(await write((tx) => blobs.sweepOrphanFiles(tx))).toBe(1);
    expect(await storage.exists(blobKey(ownerA, staged.sha256))).toBe(false);
  });

  it('sweepOrphanFiles keeps an old file that has a row', async () => {
    const blob = await register('punya baris');
    clock.advance(25 * HOUR);
    expect(await write((tx) => blobs.sweepOrphanFiles(tx))).toBe(0);
    expect(await storage.exists(blobKey(ownerA, blob.sha256))).toBe(true);
  });

  it('owner B cannot see or collect owner A blobs', async () => {
    await register('rahasia');
    clock.advance(50 * HOUR);
    expect(await writeAs(ownerB, (tx) => blobs.collectGarbage(tx))).toEqual({ marked: 0, unmarked: 0, deleted: 0 });
    expect(await countRows('blobs')).toBe(1);
  });

  it('the same content is a separate blob for each owner', async () => {
    const a = await register('sama untuk semua');
    const b = await writeAs(ownerB, async (tx) => blobs.register(tx, await stage('sama untuk semua')));
    expect(b.sha256).toBe(a.sha256);
    expect(await countRows('blobs')).toBe(2);
    expect(await storage.exists(blobKey(ownerB, b.sha256))).toBe(true);
  });
});

describe('blob maintenance task', () => {
  it('marks and later deletes an unreferenced blob and removes orphan files, each in its own transaction', async () => {
    const task = createBlobMaintenanceTask({ uow, blobs, logger: noopLogger });
    expect([task.id, task.intervalMs]).toEqual(['platform.blobMaintenance', 21_600_000]);
    const blob = await register('terbengkalai');
    const orphan = await stage('file yatim');
    await storage.publish(orphan, blobKey(ownerA, orphan.sha256));
    const signal = new AbortController().signal;

    clock.advance(BLOB_GC_GRACE_MS + HOUR);
    await task.run(issueOwnerScope(ownerA), signal);
    expect(await storage.exists(blobKey(ownerA, orphan.sha256))).toBe(false);
    expect(await storage.exists(blobKey(ownerA, blob.sha256))).toBe(true);

    clock.advance(BLOB_GC_GRACE_MS + HOUR);
    await task.run(issueOwnerScope(ownerA), signal);
    expect(await storage.exists(blobKey(ownerA, blob.sha256))).toBe(false);
    expect(await countRows('blobs')).toBe(0);
  });
});
