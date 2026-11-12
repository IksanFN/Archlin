import { qualifiedMigrationNames } from '@archlin/db/migrations';
import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { buildRegistry, systemClock, systemIds } from '@archlin/kernel';
import type { EventPublisher, OwnerScope } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { platformMigrations } from '@archlin/platform/migrations';
import { bootstrapQueue, createEventPublisher } from '@archlin/platform/server';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { noopLogger } from '@archlin/testing/fakes';
import { fixtureMigrations, fixtureModule, fixturePinged } from '@archlin/testing/fixture-module';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgBossQueue } from './pg-boss-queue';
import { createWorkerRuntime } from './runtime';

const AGGREGATE = '00000000-0000-7000-8000-00000000aaaa';
const REAL_MIGRATIONS = qualifiedMigrationNames([platformMigrations, fixtureMigrations]);

let urls: TestDbUrls;
let ownerA: string;
let scopeA: OwnerScope;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;
let publisher: EventPublisher;
let boss: PgBoss;
let runtime: ReturnType<typeof createWorkerRuntime>;
let bossErrors: unknown[];
let expectedMigrations: string[];

async function asMigrator<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    await client.end();
  }
}

const pingCount = async (): Promise<number> =>
  (await asMigrator<{ n: number }>('select coalesce(sum(received_count), 0)::int as n from public.fixture_pings where owner_id = $1', [ownerA]))
    .rows[0]?.n ?? 0;

const publishPing = () =>
  uow.write(scopeA, (tx) =>
    publisher.publish({ definition: fixturePinged, aggregateId: AGGREGATE, aggregateRevision: 1, payload: { note: 'hi' } }, tx),
  );

beforeAll(async () => {
  ({ urls, ownerA } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations] }));
  scopeA = issueOwnerScope(ownerA);
  await bootstrapQueue({ connectionString: urls.migrator, logger: noopLogger });
  db = createDatabase({ connectionString: urls.app, applicationName: 'worker-runtime-test', max: 6 });
  uow = createOwnerUnitOfWork(db);
  const registry = buildRegistry([fixtureModule]);
  publisher = createEventPublisher({ registry, ids: systemIds, clock: systemClock });
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  await asMigrator('truncate public.outbox_events, public.fixture_pings, public.fixture_audit, public.fixture_sync_marks, public.fixture_switches cascade');
  // Same connection settings the production worker uses: cortex_app, no migration, no schema creation.
  boss = new PgBoss({
    connectionString: urls.app,
    schema: 'pgboss',
    application_name: 'archlin-worker-test',
    migrate: false,
    createSchema: false,
    schedule: false,
    supervise: true,
  });
  bossErrors = [];
  boss.on('error', (error) => bossErrors.push(error));
  expectedMigrations = [...REAL_MIGRATIONS];
  runtime = createWorkerRuntime({
    db,
    uow,
    registry: buildRegistry([fixtureModule]),
    queue: createPgBossQueue(boss),
    clock: systemClock,
    logger: noopLogger,
    expectedMigrations,
    pollIntervalMs: 200,
    sweepIntervalMs: 2000,
    schemaPollMs: 200,
  });
});

afterEach(async () => {
  await runtime.stop();
});

describe('worker runtime', () => {
  it('processes an event published in a committed transaction within ten seconds', async () => {
    await runtime.start();
    await publishPing();
    await expect.poll(pingCount, { timeout: 10_000, interval: 250 }).toBe(1);
  });

  it('never processes an event whose transaction rolled back', async () => {
    await runtime.start();
    await expect(
      uow.write(scopeA, async (tx) => {
        await publisher.publish({ definition: fixturePinged, aggregateId: AGGREGATE, aggregateRevision: 1, payload: { note: 'x' } }, tx);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(await pingCount()).toBe(0);
  });

  it('runs as cortex_app without pg-boss permission errors', async () => {
    await runtime.start();
    await publishPing();
    await expect.poll(pingCount, { timeout: 10_000, interval: 250 }).toBe(1);
    // Give the supervisor a moment to run its first maintenance pass under the app role.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(bossErrors).toEqual([]);
  });

  it('waits for pending migrations before processing', async () => {
    expectedMigrations.push('fixture:299901010000_not_applied_yet');
    const started = runtime.start();
    await publishPing();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await pingCount()).toBe(0);

    expectedMigrations.pop();
    await started;
    await expect.poll(pingCount, { timeout: 10_000, interval: 250 }).toBe(1);
  });

  it('refuses to run against a schema newer than this build', async () => {
    await asMigrator(`insert into kysely_migration (name, timestamp) values ('fixture:299901010000_from_the_future', now()::text)`);
    try {
      await expect(runtime.start()).rejects.toThrow(/unknown migrations/i);
    } finally {
      await asMigrator(`delete from kysely_migration where name = 'fixture:299901010000_from_the_future'`);
    }
  });
});
