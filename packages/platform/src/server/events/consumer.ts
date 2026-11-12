import { sqlFor } from '@archlin/db/scoped';
import type { Clock, EventEnvelope, Logger, ModuleRegistry, OwnerUnitOfWork, WriteTx } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { sql } from 'kysely';
import { deliveryPointerSchema } from './job-queue';
import type { DeliveryPointer } from './job-queue';

export type DeliveryResult = 'completed' | 'already_completed' | 'not_found' | 'blocked' | 'invalid_pointer';

export interface DeliveryConsumerDeps {
  uow: OwnerUnitOfWork;
  registry: ModuleRegistry;
  clock: Clock;
  logger: Logger;
}

export interface DeliveryConsumer {
  handle(data: unknown): Promise<DeliveryResult>;
}

interface DeliveryRow {
  status: 'ready' | 'enqueued' | 'completed' | 'blocked';
  type: string;
  schema_version: number;
  aggregate_id: string;
  aggregate_revision: number;
  occurred_at: Date;
  payload: unknown;
}

type BlockReason = 'unknown_handler' | 'unsupported_event' | 'invalid_payload';

// At-least-once delivery turned into effectively-once: the handler's own writes and the 'completed' mark share one
// transaction, so a duplicate job finds the mark and does nothing.
export function createDeliveryConsumer({ uow, registry, clock, logger }: DeliveryConsumerDeps): DeliveryConsumer {
  async function block(tx: WriteTx, pointer: DeliveryPointer, reason: BlockReason): Promise<void> {
    await sql`
      update public.outbox_deliveries set status = 'blocked', last_error_code = ${reason}
      where owner_id = ${pointer.ownerId}::uuid and event_id = ${pointer.eventId}::uuid and handler_id = ${pointer.handlerId}
    `.execute(sqlFor(tx));
    logger.error({ handlerId: pointer.handlerId, reason }, 'delivery blocked');
  }

  return {
    async handle(data) {
      const parsed = deliveryPointerSchema.safeParse(data);
      if (!parsed.success) {
        logger.warn({ issues: parsed.error.issues.length }, 'ignored a malformed delivery pointer');
        return 'invalid_pointer';
      }
      const pointer = parsed.data;

      const scope = issueOwnerScope(pointer.ownerId);
      return uow.write(scope, async (tx): Promise<DeliveryResult> => {
        // Plain FOR UPDATE, not SKIP LOCKED: a duplicate waits for the first run and then sees 'completed'.
        const { rows } = await sql<DeliveryRow>`
          select d.status, e.type, e.schema_version, e.aggregate_id, e.aggregate_revision, e.occurred_at, e.payload
          from public.outbox_deliveries d
          join public.outbox_events e on e.owner_id = d.owner_id and e.event_id = d.event_id
          where d.owner_id = ${pointer.ownerId}::uuid and d.event_id = ${pointer.eventId}::uuid and d.handler_id = ${pointer.handlerId}
          for update of d
        `.execute(sqlFor(tx));
        const row = rows[0];
        if (row === undefined) return 'not_found';
        if (row.status === 'completed') return 'already_completed';
        if (row.status === 'blocked') return 'blocked';

        const handler = registry.handler(pointer.handlerId);
        if (handler === undefined) {
          await block(tx, pointer, 'unknown_handler');
          return 'blocked';
        }
        const definition = registry.event(row.type);
        if (definition === undefined || definition !== handler.event || definition.schemaVersion !== row.schema_version) {
          await block(tx, pointer, 'unsupported_event');
          return 'blocked';
        }
        let payload: unknown;
        try {
          payload = definition.payload.parse(row.payload);
        } catch {
          await block(tx, pointer, 'invalid_payload');
          return 'blocked';
        }

        const envelope: EventEnvelope<unknown> = {
          eventId: pointer.eventId,
          ownerId: scope.ownerId,
          type: row.type,
          schemaVersion: row.schema_version,
          aggregateId: row.aggregate_id,
          aggregateRevision: row.aggregate_revision,
          occurredAt: row.occurred_at.toISOString(),
          payload,
        };
        // A throwing handler rolls this transaction back and the error goes to pg-boss, which retries the job.
        await handler.handle(envelope, tx);
        await sql`
          update public.outbox_deliveries set status = 'completed', completed_at = ${clock.now().toISOString()}::timestamptz
          where owner_id = ${pointer.ownerId}::uuid and event_id = ${pointer.eventId}::uuid and handler_id = ${pointer.handlerId}
        `.execute(sqlFor(tx));
        return 'completed';
      });
    },
  };
}
