import { AsyncLocalStorage } from 'node:async_hooks';
import { ownerOf, sqlFor } from '@archlin/db/scoped';
import type { Clock, EventEnvelope, EventPublisher, Ids, ModuleRegistry, NewDomainEvent, WriteTx } from '@archlin/kernel';
import type { OutboxDatabase } from './outbox-schema';

export type EventPublishErrorCode = 'unknown_event' | 'invalid_payload' | 'nested_publish';

export class EventPublishError extends Error {
  override readonly name = 'EventPublishError';
  readonly code: EventPublishErrorCode;

  // Messages carry the event type only: payloads can hold note content (spec 13.4 K7).
  constructor(code: EventPublishErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

export interface EventPublisherDeps {
  readonly registry: ModuleRegistry;
  readonly ids: Ids;
  readonly clock: Clock;
}

export function createEventPublisher({ registry, ids, clock }: EventPublisherDeps): EventPublisher {
  // Holds the transaction while one of its sync handlers runs. Tracking the async call chain, not the transaction,
  // keeps concurrent sibling publishes (Promise.all) from counting as nested.
  const runningSyncHandler = new AsyncLocalStorage<WriteTx>();

  return {
    async publish<TPayload>(event: NewDomainEvent<TPayload>, tx: WriteTx): Promise<void> {
      const { definition } = event;

      // A sync handler that publishes again could trigger itself; handlers must return their follow-up through the caller.
      if (runningSyncHandler.getStore() === tx) {
        throw new EventPublishError('nested_publish', `Event "${definition.type}" was published from a sync handler.`);
      }
      if (registry.event(definition.type) !== definition) {
        throw new EventPublishError('unknown_event', `Event type "${definition.type}" is not registered.`);
      }
      let payload: TPayload;
      try {
        payload = definition.payload.parse(event.payload);
      } catch (cause) {
        throw new EventPublishError('invalid_payload', `Payload of "${definition.type}" does not match its schema.`, { cause });
      }

      // The owner always comes from the transaction, never from the caller.
      const envelope: EventEnvelope<TPayload> = {
        eventId: ids.uuidv7(),
        ownerId: ownerOf(tx),
        type: definition.type,
        schemaVersion: definition.schemaVersion,
        aggregateId: event.aggregateId,
        aggregateRevision: event.aggregateRevision,
        occurredAt: clock.now().toISOString(),
        payload,
      };

      // Sync handlers share the transaction: a failure here aborts the whole business change.
      for (const handler of registry.syncHandlersFor(definition.type)) {
        await runningSyncHandler.run(tx, () => handler.handle(envelope, tx));
      }

      // An event nobody consumes asynchronously leaves no outbox trace.
      const asyncHandlers = registry.asyncHandlersFor(definition.type);
      if (asyncHandlers.length === 0) return;

      const trx = sqlFor<OutboxDatabase>(tx);
      await trx
        .insertInto('outbox_events')
        .values({
          owner_id: envelope.ownerId,
          event_id: envelope.eventId,
          type: envelope.type,
          schema_version: envelope.schemaVersion,
          aggregate_id: envelope.aggregateId,
          aggregate_revision: envelope.aggregateRevision,
          occurred_at: envelope.occurredAt,
          payload: JSON.stringify(envelope.payload),
        })
        .execute();
      await trx
        .insertInto('outbox_deliveries')
        .values(
          asyncHandlers.map((handler) => ({
            owner_id: envelope.ownerId,
            event_id: envelope.eventId,
            handler_id: handler.id,
            status: 'ready' as const,
            next_attempt_at: envelope.occurredAt,
            created_at: envelope.occurredAt,
          })),
        )
        .execute();
    },
  };
}
