import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { buildRegistry } from '@archlin/kernel';
import type { EventEnvelope, OwnerScope } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureMigrations, fixtureModule } from '../../fixtures/fixture-module';
import { createTwoOwnerDatabase } from './multi-owner';
import type { TestDbUrls } from './urls';

// The fixture handlers are the stand-in for module code in the outbox and worker tests, so they are tested here once.
const registry = buildRegistry([fixtureModule]);
const handler = (id: string) => {
  const found = registry.handler(`fixture.${id}`);
  if (!found) throw new Error(`fixture handler ${id} is not registered`);
  return found;
};

let urls: TestDbUrls;
let ownerA: string;
let scopeA: OwnerScope;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;

const envelope = (note = 'hi'): EventEnvelope<unknown> => ({
  eventId: '00000000-0000-7000-8000-000000000001',
  ownerId: ownerA as EventEnvelope<unknown>['ownerId'],
  type: 'fixture.pinged',
  schemaVersion: 1,
  aggregateId: '00000000-0000-7000-8000-00000000aaaa',
  aggregateRevision: 1,
  occurredAt: '2026-11-11T10:00:00.000Z',
  payload: { note },
});

async function rows(table: string): Promise<Record<string, unknown>[]> {
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    return (await client.query(`select * from public.${table} order by 1, 2`)).rows;
  } finally {
    await client.end();
  }
}
const setSwitch = async (column: 'fail_ping' | 'fail_audit') => {
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    await client.query(`insert into public.fixture_switches (owner_id, ${column}) values ($1, true)
      on conflict (owner_id) do update set ${column} = true`, [ownerA]);
  } finally {
    await client.end();
  }
};

beforeAll(async () => {
  ({ urls, ownerA } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations] }));
  scopeA = issueOwnerScope(ownerA);
  db = createDatabase({ connectionString: urls.app, applicationName: 'fixture-test', max: 2 });
  uow = createOwnerUnitOfWork(db);
});

afterAll(async () => {
  await db.destroy();
});

describe('fixture module', () => {
  it('registers one sync and two async handlers for fixture.pinged', () => {
    expect(registry.syncHandlersFor('fixture.pinged').map((h) => h.id)).toEqual(['fixture.markSync']);
    expect(registry.asyncHandlersFor('fixture.pinged').map((h) => h.id)).toEqual(['fixture.recordPing', 'fixture.recordAudit']);
  });

  it('markSync records the aggregate once per owner and fails on the fail-sync note', async () => {
    await uow.write(scopeA, (tx) => handler('markSync').handle(envelope(), tx));
    expect(await rows('fixture_sync_marks')).toEqual([{ owner_id: ownerA, aggregate_id: envelope().aggregateId }]);
    await expect(uow.write(scopeA, (tx) => handler('markSync').handle(envelope('fail-sync'), tx))).rejects.toThrow(
      'fixture sync failure',
    );
  });

  it('recordPing counts duplicate deliveries instead of hiding them', async () => {
    await uow.write(scopeA, (tx) => handler('recordPing').handle(envelope(), tx));
    await uow.write(scopeA, (tx) => handler('recordPing').handle(envelope(), tx));
    expect(await rows('fixture_pings')).toEqual([
      { owner_id: ownerA, event_id: envelope().eventId, received_count: 2 },
    ]);
  });

  it('recordAudit is idempotent', async () => {
    await uow.write(scopeA, (tx) => handler('recordAudit').handle(envelope(), tx));
    await uow.write(scopeA, (tx) => handler('recordAudit').handle(envelope(), tx));
    expect(await rows('fixture_audit')).toEqual([{ owner_id: ownerA, event_id: envelope().eventId }]);
  });

  it('the failure switches make each async handler throw and leave no effect', async () => {
    await setSwitch('fail_ping');
    await setSwitch('fail_audit');
    const other = { ...envelope(), eventId: '00000000-0000-7000-8000-000000000002' };
    await expect(uow.write(scopeA, (tx) => handler('recordPing').handle(other, tx))).rejects.toThrow('fixture ping failure');
    await expect(uow.write(scopeA, (tx) => handler('recordAudit').handle(other, tx))).rejects.toThrow('fixture audit failure');
    expect((await rows('fixture_pings')).map((r) => r.event_id)).toEqual([envelope().eventId]);
    expect((await rows('fixture_audit')).map((r) => r.event_id)).toEqual([envelope().eventId]);
  });
});
