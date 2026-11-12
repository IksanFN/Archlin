import { sqlFor } from '@archlin/db/scoped';
import type { Clock, Logger, OwnerUnitOfWork } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { ENQUEUED_TIMEOUT_MS, MAX_DELIVERY_ATTEMPTS, sendRetryDelayMs } from './job-queue';
import type { DeliveryPointer, JobQueue } from './job-queue';

export interface OutboxRelayDeps {
  db: Kysely<unknown>;
  uow: OwnerUnitOfWork;
  queue: JobQueue;
  clock: Clock;
  logger: Logger;
  batchSize?: number;
}

export interface OutboxRelay {
  tick(): Promise<{ enqueued: number }>;
  sweep(): Promise<{ requeued: number; blocked: number }>;
}

interface Claimed {
  pointer: DeliveryPointer;
  attempts: number;
}

const DEFAULT_BATCH = 100;

// Moves due deliveries to the queue, one owner at a time so row level security scopes every statement.
export function createOutboxRelay({ db, uow, queue, clock, logger, batchSize = DEFAULT_BATCH }: OutboxRelayDeps): OutboxRelay {
  async function ownerIds(): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`select public.auth_list_owner_ids() as id`.execute(db);
    return rows.map((row) => row.id);
  }

  // Claiming commits before anything is sent, so a crash after this point leaves 'enqueued' rows for the sweeper.
  async function claim(ownerId: string, nowIso: string): Promise<Claimed[]> {
    return uow.write(issueOwnerScope(ownerId), async (tx) => {
      const { rows } = await sql<{ owner_id: string; event_id: string; handler_id: string; attempts: number }>`
        with due as (
          select owner_id, event_id, handler_id from public.outbox_deliveries
          where status = 'ready' and next_attempt_at <= ${nowIso}::timestamptz
          order by next_attempt_at
          limit ${batchSize}
          for update skip locked
        )
        update public.outbox_deliveries d
        set status = 'enqueued', enqueued_at = ${nowIso}::timestamptz, attempts = d.attempts + 1
        from due
        where d.owner_id = due.owner_id and d.event_id = due.event_id and d.handler_id = due.handler_id
        returning d.owner_id, d.event_id, d.handler_id, d.attempts
      `.execute(sqlFor(tx));
      return rows.map((row) => ({
        pointer: { ownerId: row.owner_id, eventId: row.event_id, handlerId: row.handler_id },
        attempts: row.attempts,
      }));
    });
  }

  // Compare-and-set on the claim time: a consumer that already completed the delivery is not overwritten.
  async function release(claimed: Claimed, enqueuedAtIso: string): Promise<void> {
    const retryAt = new Date(clock.now().getTime() + sendRetryDelayMs(claimed.attempts)).toISOString();
    const { ownerId, eventId, handlerId } = claimed.pointer;
    await uow.write(issueOwnerScope(ownerId), (tx) =>
      sql`
        update public.outbox_deliveries
        set status = 'ready', enqueued_at = null, next_attempt_at = ${retryAt}::timestamptz, last_error_code = 'send_failed'
        where owner_id = ${ownerId}::uuid and event_id = ${eventId}::uuid and handler_id = ${handlerId}
          and status = 'enqueued' and enqueued_at = ${enqueuedAtIso}::timestamptz
      `.execute(sqlFor(tx)),
    );
  }

  return {
    async tick() {
      let enqueued = 0;
      let failed = 0;
      for (const ownerId of await ownerIds()) {
        const nowIso = clock.now().toISOString();
        for (const item of await claim(ownerId, nowIso)) {
          try {
            await queue.send(item.pointer);
            enqueued += 1;
          } catch {
            failed += 1;
            await release(item, nowIso);
          }
        }
      }
      if (enqueued + failed > 0) logger.info({ enqueued, failed }, 'outbox relay tick');
      return { enqueued };
    },

    async sweep() {
      let requeued = 0;
      let blocked = 0;
      const nowIso = clock.now().toISOString();
      const cutoffIso = new Date(clock.now().getTime() - ENQUEUED_TIMEOUT_MS).toISOString();
      for (const ownerId of await ownerIds()) {
        const rows = await uow.write(issueOwnerScope(ownerId), async (tx) => {
          const result = await sql<{ status: 'ready' | 'blocked' }>`
            update public.outbox_deliveries
            set status = case when attempts >= ${MAX_DELIVERY_ATTEMPTS} then 'blocked' else 'ready' end,
                last_error_code = case when attempts >= ${MAX_DELIVERY_ATTEMPTS} then 'max_attempts' else last_error_code end,
                enqueued_at = null,
                next_attempt_at = case when attempts >= ${MAX_DELIVERY_ATTEMPTS} then next_attempt_at else ${nowIso}::timestamptz end
            where status = 'enqueued' and enqueued_at < ${cutoffIso}::timestamptz
            returning status
          `.execute(sqlFor(tx));
          return result.rows;
        });
        for (const row of rows) {
          if (row.status === 'blocked') blocked += 1;
          else requeued += 1;
        }
      }
      if (requeued + blocked > 0) logger.warn({ requeued, blocked }, 'outbox sweeper recovered deliveries');
      return { requeued, blocked };
    },
  };
}
