import { sqlFor } from '@archlin/db/scoped';
import { defineEvent, defineHandler, defineModule } from '@archlin/kernel';
import { sql } from 'kysely';
import { z } from 'zod';

// A module that exists only for tests: it proves that the platform finds, runs and isolates module code
// without any change to platform code (spec 16, criterion S5).
export const fixturePinged = defineEvent({
  type: 'fixture.pinged',
  schemaVersion: 1,
  payload: z.strictObject({ note: z.string().max(200) }),
});

// Sync: runs inside the publisher's transaction. The note 'fail-sync' makes it throw after writing, so tests can see
// that the write is rolled back with the business change.
const markSync = defineHandler({
  id: 'markSync',
  event: fixturePinged,
  mode: 'sync',
  handle: async (event, tx) => {
    await sql`insert into public.fixture_sync_marks (owner_id, aggregate_id)
              values (${event.ownerId}, ${event.aggregateId}) on conflict do nothing`.execute(sqlFor(tx));
    if (event.payload.note === 'fail-sync') {
      throw new Error('fixture sync failure');
    }
  },
});

// Async handlers read their failure switch through the same owner-scoped transaction, so a test flips it per owner.
const recordPing = defineHandler({
  id: 'recordPing',
  event: fixturePinged,
  mode: 'async',
  handle: async (event, tx) => {
    const trx = sqlFor(tx);
    const { rows } = await sql<{ fail: boolean }>`select fail_ping as fail from public.fixture_switches`.execute(trx);
    if (rows[0]?.fail) {
      throw new Error('fixture ping failure');
    }
    // A repeated delivery is visible as received_count > 1, which is how tests detect duplicates.
    await sql`insert into public.fixture_pings (owner_id, event_id) values (${event.ownerId}, ${event.eventId})
              on conflict (owner_id, event_id) do update set received_count = fixture_pings.received_count + 1`.execute(trx);
  },
});

const recordAudit = defineHandler({
  id: 'recordAudit',
  event: fixturePinged,
  mode: 'async',
  handle: async (event, tx) => {
    const trx = sqlFor(tx);
    const { rows } = await sql<{ fail: boolean }>`select fail_audit as fail from public.fixture_switches`.execute(trx);
    if (rows[0]?.fail) {
      throw new Error('fixture audit failure');
    }
    await sql`insert into public.fixture_audit (owner_id, event_id) values (${event.ownerId}, ${event.eventId})
              on conflict do nothing`.execute(trx);
  },
});

export const fixtureModule = defineModule({
  id: 'fixture',
  events: [fixturePinged],
  eventHandlers: [markSync, recordPing, recordAudit],
});
