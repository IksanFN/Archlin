import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { buildRegistry, defineEvent, defineHandler, defineModule } from '@archlin/kernel';
import type { EventEnvelope, EventPublisher, OwnerScope } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { FakeClock, SequenceIds } from '@archlin/testing/fakes';
import { fixtureMigrations, fixtureModule, fixturePinged } from '@archlin/testing/fixture-module';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEventPublisher, EventPublishError } from './index';

const NOW = new Date('2026-11-11T10:00:00.000Z');

// Extra modules for behaviors the fixture module does not have: envelope capture, nested publish, sync-only events.
const captured: EventEnvelope<unknown>[] = [];
const order: string[] = [];
const spyEvent = defineEvent({ type: 'spy.pinged', schemaVersion: 2, payload: z.strictObject({ n: z.number() }) });
const spyModule = defineModule({
  id: 'spy',
  events: [spyEvent],
  eventHandlers: [
    defineHandler({
      id: 'first',
      event: spyEvent,
      mode: 'sync',
      handle: async (event) => {
        order.push('first');
        captured.push(event);
      },
    }),
    defineHandler({
      id: 'second',
      event: spyEvent,
      mode: 'sync',
      handle: async () => {
        order.push('second');
      },
    }),
    defineHandler({ id: 'later', event: spyEvent, mode: 'async', handle: async () => undefined }),
  ],
});

let publisher: EventPublisher;
const nestEvent = defineEvent({ type: 'nest.ping', schemaVersion: 1, payload: z.strictObject({}) });
const quietEvent = defineEvent({ type: 'nest.quiet', schemaVersion: 1, payload: z.strictObject({}) });
const nestModule = defineModule({
  id: 'nest',
  events: [nestEvent, quietEvent],
  eventHandlers: [
    defineHandler({
      id: 'again',
      event: nestEvent,
      mode: 'sync',
      handle: async (_event, tx) => {
        await publisher.publish({ definition: nestEvent, aggregateId: AGGREGATE, aggregateRevision: 1, payload: {} }, tx);
      },
    }),
    defineHandler({ id: 'noop', event: quietEvent, mode: 'sync', handle: async () => undefined }),
  ],
});

const AGGREGATE = '00000000-0000-7000-8000-00000000aaaa';
let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let scopeA: OwnerScope;
let scopeB: OwnerScope;
let uow: ReturnType<typeof createOwnerUnitOfWork>;
let db: ReturnType<typeof createDatabase>;

async function asMigrator(text: string, params: unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}
const countRows = async (table: string, owner: string): Promise<number> =>
  (await asMigrator(`select count(*)::int as n from public.${table} where owner_id = $1`, [owner])).rows[0].n;

const pinged = (note = 'hi') => ({ definition: fixturePinged, aggregateId: AGGREGATE, aggregateRevision: 1, payload: { note } });

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations] }));
  scopeA = issueOwnerScope(ownerA);
  scopeB = issueOwnerScope(ownerB);
  db = createDatabase({ connectionString: urls.app, applicationName: 'publisher-test', max: 3 });
  uow = createOwnerUnitOfWork(db);
  publisher = createEventPublisher({
    registry: buildRegistry([fixtureModule, spyModule, nestModule]),
    ids: new SequenceIds(),
    clock: new FakeClock(NOW),
  });
});

afterAll(async () => {
  await db.destroy();
});

describe('event publisher', () => {
  it('stores one delivery per async handler inside the business transaction', async () => {
    await uow.write(scopeA, (tx) => publisher.publish(pinged(), tx));

    const deliveries = await asMigrator(
      'select handler_id, status from outbox_deliveries where owner_id = $1 order by handler_id',
      [ownerA],
    );
    expect(deliveries.rows).toEqual([
      { handler_id: 'fixture.recordAudit', status: 'ready' },
      { handler_id: 'fixture.recordPing', status: 'ready' },
    ]);
    const events = await asMigrator(
      'select type, schema_version, aggregate_id, aggregate_revision, occurred_at, payload from outbox_events where owner_id = $1',
      [ownerA],
    );
    expect(events.rows).toEqual([
      {
        type: 'fixture.pinged',
        schema_version: 1,
        aggregate_id: AGGREGATE,
        aggregate_revision: 1,
        occurred_at: NOW,
        payload: { note: 'hi' },
      },
    ]);
    const due = await asMigrator('select next_attempt_at, attempts, enqueued_at, completed_at from outbox_deliveries where owner_id = $1', [ownerA]);
    expect(due.rows).toEqual([
      { next_attempt_at: NOW, attempts: 0, enqueued_at: null, completed_at: null },
      { next_attempt_at: NOW, attempts: 0, enqueued_at: null, completed_at: null },
    ]);
  });

  it('runs the sync handler in the same transaction', async () => {
    expect(await countRows('fixture_sync_marks', ownerA)).toBe(1);
  });

  it('leaves no event, delivery or sync effect when the transaction rolls back', async () => {
    const before = {
      events: await countRows('outbox_events', ownerB),
      marks: await countRows('fixture_sync_marks', ownerB),
    };
    await expect(
      uow.write(scopeB, async (tx) => {
        await publisher.publish(pinged(), tx);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await countRows('outbox_events', ownerB)).toBe(before.events);
    expect(await countRows('outbox_deliveries', ownerB)).toBe(0);
    expect(await countRows('fixture_sync_marks', ownerB)).toBe(before.marks);
  });

  it('aborts the transaction when a sync handler fails', async () => {
    await expect(uow.write(scopeB, (tx) => publisher.publish(pinged('fail-sync'), tx))).rejects.toThrow('fixture sync failure');
    expect(await countRows('outbox_events', ownerB)).toBe(0);
    expect(await countRows('fixture_sync_marks', ownerB)).toBe(0);
  });

  it('rejects payloads that do not match the event schema', async () => {
    const bad = { ...pinged(), payload: { note: 1 } } as unknown as ReturnType<typeof pinged>;
    const error = await uow.write(scopeB, (tx) => publisher.publish(bad, tx)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EventPublishError);
    expect(error).toMatchObject({ code: 'invalid_payload' });
    expect(await countRows('fixture_sync_marks', ownerB)).toBe(0);
  });

  it('rejects an event that is not registered', async () => {
    const stranger = defineEvent({ type: 'nobody.pinged', schemaVersion: 1, payload: z.strictObject({}) });
    const lookalike = defineEvent({ type: 'fixture.pinged', schemaVersion: 1, payload: z.strictObject({ note: z.string() }) });
    for (const definition of [stranger, lookalike]) {
      const error = await uow
        .write(scopeB, (tx) =>
          publisher.publish({ definition, aggregateId: AGGREGATE, aggregateRevision: 1, payload: { note: 'x' } } as never, tx),
        )
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'unknown_event' });
    }
  });

  it('rejects nested publish from a sync handler and stays usable afterwards', async () => {
    const error = await uow
      .write(scopeB, (tx) => publisher.publish({ definition: nestEvent, aggregateId: AGGREGATE, aggregateRevision: 1, payload: {} }, tx))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EventPublishError);
    expect(error).toMatchObject({ code: 'nested_publish' });

    await uow.write(scopeB, async (tx) => {
      await publisher.publish(pinged('one'), tx);
      await publisher.publish(pinged('two'), tx);
    });
    expect(await countRows('outbox_events', ownerB)).toBe(2);
  });

  it('derives the owner from the transaction, not from input', async () => {
    const marks = await asMigrator('select owner_id from fixture_sync_marks');
    expect(new Set(marks.rows.map((r) => r.owner_id))).toEqual(new Set([ownerA, ownerB]));
    const events = await asMigrator('select distinct owner_id from outbox_events order by owner_id');
    expect(new Set(events.rows.map((r) => r.owner_id))).toEqual(new Set([ownerA, ownerB]));
  });

  it('does not store events that have no async subscriber', async () => {
    const before = await countRows('outbox_events', ownerA);
    await uow.write(scopeA, (tx) =>
      publisher.publish({ definition: quietEvent, aggregateId: AGGREGATE, aggregateRevision: 1, payload: {} }, tx),
    );
    expect(await countRows('outbox_events', ownerA)).toBe(before);
  });

  it('hands sync handlers the full envelope, in registration order, and stores the same event id', async () => {
    captured.length = 0;
    order.length = 0;
    await uow.write(scopeA, (tx) =>
      publisher.publish({ definition: spyEvent, aggregateId: AGGREGATE, aggregateRevision: 7, payload: { n: 3 } }, tx),
    );
    expect(order).toEqual(['first', 'second']);
    expect(captured).toHaveLength(1);
    const [envelope] = captured;
    expect(envelope).toMatchObject({
      ownerId: ownerA,
      type: 'spy.pinged',
      schemaVersion: 2,
      aggregateId: AGGREGATE,
      aggregateRevision: 7,
      occurredAt: NOW.toISOString(),
      payload: { n: 3 },
    });
    const stored = await asMigrator(`select event_id, schema_version from outbox_events where type = 'spy.pinged'`);
    expect(stored.rows).toEqual([{ event_id: envelope?.eventId, schema_version: 2 }]);
  });
});
