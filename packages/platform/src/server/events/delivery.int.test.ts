import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { buildRegistry } from '@archlin/kernel';
import type { EventPublisher, OwnerScope } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { createInMemoryJobQueue, FakeClock, noopLogger, SequenceIds } from '@archlin/testing/fakes';
import { fixtureMigrations, fixtureModule, fixturePinged } from '@archlin/testing/fixture-module';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDeliveryConsumer, createEventPublisher, createOutboxRelay, ENQUEUED_TIMEOUT_MS } from './index';
import type { JobQueue } from './index';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const AGGREGATE = '00000000-0000-7000-8000-00000000aaaa';
const RECORD_PING = 'fixture.recordPing';
const RECORD_AUDIT = 'fixture.recordAudit';

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let scopeA: OwnerScope;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;
let publisher: EventPublisher;
let relay: ReturnType<typeof createOutboxRelay>;
let consumer: ReturnType<typeof createDeliveryConsumer>;
const clock = new FakeClock(NOW);
const queue = createInMemoryJobQueue();

async function asMigrator<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    await client.end();
  }
}

const publishPing = (note = 'hi', scope: OwnerScope = scopeA) =>
  uow.write(scope, (tx) =>
    publisher.publish({ definition: fixturePinged, aggregateId: AGGREGATE, aggregateRevision: 1, payload: { note } }, tx),
  );

const pingCount = async (): Promise<number> =>
  (await asMigrator<{ n: number }>('select coalesce(sum(received_count), 0)::int as n from public.fixture_pings where owner_id = $1', [ownerA]))
    .rows[0]?.n ?? 0;

const deliveryRows = async () =>
  (
    await asMigrator<{ handler_id: string; status: string; attempts: number; next_attempt_at: Date; enqueued_at: Date | null; last_error_code: string | null }>(
      'select handler_id, status, attempts, next_attempt_at, enqueued_at, last_error_code from public.outbox_deliveries where owner_id = $1 order by handler_id',
      [ownerA],
    )
  ).rows;

const pointerFor = (handlerId: string) => {
  const pointer = queue.sent().find((candidate) => candidate.handlerId === handlerId);
  if (pointer === undefined) throw new Error(`no pointer was sent for ${handlerId}`);
  return pointer;
};

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations] }));
  scopeA = issueOwnerScope(ownerA);
  db = createDatabase({ connectionString: urls.app, applicationName: 'delivery-test', max: 4 });
  uow = createOwnerUnitOfWork(db);
  const registry = buildRegistry([fixtureModule]);
  publisher = createEventPublisher({ registry, ids: new SequenceIds(), clock });
  relay = createOutboxRelay({ db, uow, queue, clock, logger: noopLogger });
  consumer = createDeliveryConsumer({ uow, registry, clock, logger: noopLogger });
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  await asMigrator(
    'truncate public.outbox_events, public.fixture_pings, public.fixture_audit, public.fixture_sync_marks, public.fixture_switches cascade',
  );
  queue.dropAll();
  clock.set(NOW);
});

describe('outbox relay and delivery consumer', () => {
  it('relays ready deliveries and the consumer completes them', async () => {
    await publishPing('hi');
    expect(await relay.tick()).toEqual({ enqueued: 2 });
    for (const pointer of queue.sent()) expect(await consumer.handle(pointer)).toBe('completed');
    expect(await pingCount()).toBe(1);
  });

  it('never delivers a publish whose transaction rolled back', async () => {
    await expect(
      uow.write(scopeA, async (tx) => {
        await publisher.publish({ definition: fixturePinged, aggregateId: AGGREGATE, aggregateRevision: 1, payload: { note: 'x' } }, tx);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await relay.tick()).toEqual({ enqueued: 0 });
    expect(queue.sent()).toHaveLength(0);
  });

  it('applies a duplicated pointer once', async () => {
    await publishPing();
    await relay.tick();
    const pointer = pointerFor(RECORD_PING);
    expect(await consumer.handle(pointer)).toBe('completed');
    expect(await consumer.handle(pointer)).toBe('already_completed');
    expect(await pingCount()).toBe(1);
  });

  it('recovers a lost job through the sweeper after five minutes', async () => {
    await publishPing();
    await relay.tick();
    queue.dropAll();
    clock.advance(ENQUEUED_TIMEOUT_MS + 1);
    expect(await relay.sweep()).toMatchObject({ requeued: 2 });
    expect(await relay.tick()).toEqual({ enqueued: 2 });
    for (const pointer of queue.sent()) expect(await consumer.handle(pointer)).toBe('completed');
    expect(await pingCount()).toBe(1);
  });

  it('does not requeue a job that is still within the timeout', async () => {
    await publishPing();
    await relay.tick();
    clock.advance(ENQUEUED_TIMEOUT_MS - 1);
    expect(await relay.sweep()).toEqual({ requeued: 0, blocked: 0 });
  });

  it('keeps a failing handler pending while the other handler completes', async () => {
    await asMigrator('insert into public.fixture_switches (owner_id, fail_ping) values ($1, true)', [ownerA]);
    await publishPing();
    await relay.tick();
    expect(await consumer.handle(pointerFor(RECORD_AUDIT))).toBe('completed');
    await expect(consumer.handle(pointerFor(RECORD_PING))).rejects.toThrow('fixture ping failure');

    const rows = await deliveryRows();
    expect(rows.find((row) => row.handler_id === RECORD_AUDIT)?.status).toBe('completed');
    expect(rows.find((row) => row.handler_id === RECORD_PING)?.status).toBe('enqueued');
    expect(await pingCount()).toBe(0);
  });

  it('ignores a pointer that names another owner', async () => {
    await publishPing();
    await relay.tick();
    const pointer = pointerFor(RECORD_PING);
    expect(await consumer.handle({ ...pointer, ownerId: ownerB })).toBe('not_found');
    expect(await pingCount()).toBe(0);
    expect((await deliveryRows()).every((row) => row.status === 'enqueued')).toBe(true);
  });

  it('blocks a delivery after ten attempts', async () => {
    await publishPing();
    await relay.tick();
    await asMigrator('update public.outbox_deliveries set attempts = 10 where owner_id = $1', [ownerA]);
    clock.advance(ENQUEUED_TIMEOUT_MS + 1);
    expect(await relay.sweep()).toEqual({ requeued: 0, blocked: 2 });
    for (const row of await deliveryRows()) {
      expect(row.status).toBe('blocked');
      expect(row.last_error_code).toBe('max_attempts');
    }
    expect(await relay.tick()).toEqual({ enqueued: 0 });
  });

  it('blocks a delivery whose handler is not registered', async () => {
    await publishPing();
    await relay.tick();
    const withoutFixture = createDeliveryConsumer({ uow, registry: buildRegistry([]), clock, logger: noopLogger });
    expect(await withoutFixture.handle(pointerFor(RECORD_PING))).toBe('blocked');
    const row = (await deliveryRows()).find((candidate) => candidate.handler_id === RECORD_PING);
    expect(row).toMatchObject({ status: 'blocked', last_error_code: 'unknown_handler' });
    expect(await consumer.handle(pointerFor(RECORD_PING))).toBe('blocked');
  });

  it('blocks a delivery whose event version this build does not know', async () => {
    await publishPing();
    await relay.tick();
    await asMigrator('update public.outbox_events set schema_version = 2 where owner_id = $1', [ownerA]);
    expect(await consumer.handle(pointerFor(RECORD_PING))).toBe('blocked');
    const row = (await deliveryRows()).find((candidate) => candidate.handler_id === RECORD_PING);
    expect(row?.last_error_code).toBe('unsupported_event');
  });

  it('blocks a delivery whose stored payload no longer matches the schema', async () => {
    await publishPing();
    await relay.tick();
    await asMigrator(`update public.outbox_events set payload = '{"unexpected":1}'::jsonb where owner_id = $1`, [ownerA]);
    expect(await consumer.handle(pointerFor(RECORD_PING))).toBe('blocked');
    const row = (await deliveryRows()).find((candidate) => candidate.handler_id === RECORD_PING);
    expect(row?.last_error_code).toBe('invalid_payload');
  });

  it('returns the delivery to ready with backoff when sending fails', async () => {
    await publishPing();
    queue.failNextSends(1);
    expect(await relay.tick()).toEqual({ enqueued: 1 });

    const rows = await deliveryRows();
    const failed = rows.find((row) => row.status === 'ready');
    expect(failed).toBeDefined();
    expect(failed?.enqueued_at).toBeNull();
    expect(failed?.attempts).toBe(1);
    expect(failed?.next_attempt_at.getTime()).toBe(NOW.getTime() + 2000);
    expect(rows.filter((row) => row.status === 'enqueued')).toHaveLength(1);

    // Not due yet, then due once the backoff has passed.
    expect(await relay.tick()).toEqual({ enqueued: 0 });
    clock.advance(2000);
    expect(await relay.tick()).toEqual({ enqueued: 1 });
  });

  it('does not undo a delivery the consumer completed before a send failure was recorded', async () => {
    // The consumer finishes the job, then the send is reported as failed (a timeout after the queue accepted it).
    const racingQueue: JobQueue = {
      async send(pointer) {
        await consumer.handle(pointer);
        throw new Error('send reported a failure after the job already ran');
      },
    };
    const racingRelay = createOutboxRelay({ db, uow, queue: racingQueue, clock, logger: noopLogger });
    await publishPing();
    expect(await racingRelay.tick()).toEqual({ enqueued: 0 });

    expect((await deliveryRows()).map((row) => row.status)).toEqual(['completed', 'completed']);
    expect(await pingCount()).toBe(1);
  });

  it('rejects malformed pointers without retry', async () => {
    expect(await consumer.handle({ ownerId: 'x' })).toBe('invalid_pointer');
    expect(await consumer.handle(null)).toBe('invalid_pointer');
    expect(await consumer.handle({ ownerId: ownerA, eventId: AGGREGATE, handlerId: 'Bad Handler' })).toBe('invalid_pointer');
  });
});
