import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { sqlFor } from '@archlin/db/scoped';
import { buildRegistry, systemIds } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
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
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { knowledgeMigrations } from '../migrations';
import type { SnapshotReason } from '../shared/inputs';
import { createKnowledgeApi } from './api';
import { createKnowledgeModule } from './module';
import { pruneVersions } from './retention';
import type { KnowledgeDatabase } from './schema';
import { seedSystemNoteTypes } from './seed';
import { insertVersion } from './version-store';

const NOW = new Date('2026-11-16T00:00:00.000Z');

const registry = buildRegistry([createKnowledgeModule({ ids: systemIds })], PLATFORM_EVENTS);
const clock = new FakeClock(NOW);
const ids = new SequenceIds();
const publisher = createEventPublisher({ registry, ids: systemIds, clock });
const spaces = createSpaceService({ registry, ids: systemIds, clock });
const tree = createTreeService({ registry, publisher, clock, ids: systemIds });
const tags = createTagService({ tree, ids: systemIds, clock });
const links = createLinkService({ registry, ids: systemIds, clock });
const blobs = createBlobService({ registry, files: createInMemoryStorage(clock), clock });
const api = createKnowledgeApi({ tree, tags, links, blobs, publisher, clock, ids });

let urls: TestDbUrls;
let ownerA: string;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;
let page: { entityId: string };

const scopeA = () => issueOwnerScope(ownerA);

async function asMigrator(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  ({ urls, ownerA } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations, knowledgeMigrations] }));
  db = createDatabase({ connectionString: urls.app, applicationName: 'retention-test', max: 4 });
  uow = createOwnerUnitOfWork(db);
  await uow.write(scopeA(), (tx) => seedSystemNoteTypes(sqlFor<KnowledgeDatabase>(tx), ownerA, systemIds, NOW));
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  clock.set(NOW);
  await asMigrator('DELETE FROM public.entities');
  await asMigrator('DELETE FROM public.spaces');
  await asMigrator('DELETE FROM public.user_settings WHERE owner_id = $1', [ownerA]);
  const space = await uow.write(scopeA(), (tx) => spaces.create(tx, { name: 'Basis', icon: null }));
  const noteType = await uow.read(scopeA(), (tx) =>
    sqlFor<KnowledgeDatabase>(tx).selectFrom('kb_note_types').select('id').where('key', '=', 'quick_note').executeTakeFirstOrThrow(),
  );
  page = await uow.write(scopeA(), (tx) =>
    api.pages.createPage(tx, { spaceId: space.id, parentId: null, noteTypeId: noteType.id, placement: 'last', title: 'Runbook' }),
  );
});

// Inserts through the production writer, with the clock set to each version's own time.
async function versionsAt(entityId: string, times: string[], reason: SnapshotReason): Promise<void> {
  const locked = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, entityId));
  for (const time of times) {
    clock.set(new Date(time));
    await uow.write(scopeA(), (tx) =>
      insertVersion(tx, { ids, clock }, {
        snapshot: {
          entityId,
          version: locked.version,
          title: locked.title,
          content: locked.content,
          contentText: '',
          contentHash: 'a'.repeat(64),
          noteTypeId: locked.noteType.id,
          properties: {},
          context: locked.context,
        },
        reason,
        label: null,
      }),
    );
  }
}

const prune = (now: string) => uow.write(scopeA(), (tx) => pruneVersions(tx, new Date(now)));

const list = () => uow.read(scopeA(), (tx) => api.versions.list(tx, { entityId: page.entityId, before: null }));

async function setTimezone(timezone: string): Promise<void> {
  await asMigrator(
    `INSERT INTO public.user_settings (owner_id, timezone, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (owner_id) DO UPDATE SET timezone = EXCLUDED.timezone`,
    [ownerA, timezone],
  );
}

describe('pruneVersions', () => {
  it('keeps every version of the last 30 days', async () => {
    await versionsAt(page.entityId, ['2026-11-01T02:00:00Z', '2026-11-01T03:00:00Z'], 'idle');
    expect(await prune('2026-11-16T00:00:00Z')).toBe(0);
  });

  it('keeps only the last version of each local day once older than 30 days', async () => {
    await versionsAt(page.entityId, ['2026-09-01T01:00:00Z', '2026-09-01T02:00:00Z', '2026-09-01T03:00:00Z'], 'leave');
    expect(await prune('2026-11-16T00:00:00Z')).toBe(2);
    expect((await list()).items.map((v) => v.createdAt)).toEqual(['2026-09-01T03:00:00.000Z']);
  });

  it('never prunes manual and import versions', async () => {
    await versionsAt(page.entityId, ['2026-09-01T01:00:00Z'], 'manual');
    await versionsAt(page.entityId, ['2026-09-01T01:30:00Z'], 'import');
    await versionsAt(page.entityId, ['2026-09-01T02:00:00Z'], 'idle');
    expect(await prune('2026-11-16T00:00:00Z')).toBe(0);
  });

  it('follows the owner timezone for the day boundary', async () => {
    // 16:30Z and 17:30Z are 23:30 and 00:30 in Asia/Jakarta: two local days, so both are the last of their day.
    await versionsAt(page.entityId, ['2026-09-01T16:30:00Z', '2026-09-01T17:30:00Z'], 'idle');
    expect(await prune('2026-11-16T00:00:00Z')).toBe(0);
    await setTimezone('UTC');
    expect(await prune('2026-11-16T00:00:00Z')).toBe(1);
  });

  it('never prunes the last version of a day even when a manual one is earlier that day', async () => {
    await versionsAt(page.entityId, ['2026-09-01T01:00:00Z'], 'manual');
    await versionsAt(page.entityId, ['2026-09-01T02:00:00Z', '2026-09-01T03:00:00Z'], 'idle');
    expect(await prune('2026-11-16T00:00:00Z')).toBe(1);
    expect((await list()).items.map((v) => v.reason)).toEqual(['idle', 'manual']);
  });

  it('is idempotent', async () => {
    await versionsAt(page.entityId, ['2026-09-01T01:00:00Z', '2026-09-01T02:00:00Z'], 'leave');
    expect(await prune('2026-11-16T00:00:00Z')).toBe(1);
    expect(await prune('2026-11-16T00:00:00Z')).toBe(0);
  });
});
