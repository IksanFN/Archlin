import type { OwnerId, WriteTx } from './uow';

// Structural on purpose: a Zod schema satisfies this, and the kernel stays free of any validation library.
export interface PayloadSchema<T> {
  parse(input: unknown): T;
}

export interface EventDefinition<TPayload> {
  readonly type: string;
  readonly schemaVersion: number;
  readonly payload: PayloadSchema<TPayload>;
}

// Identity helper that lets TypeScript infer TPayload from the schema.
export function defineEvent<TPayload>(def: EventDefinition<TPayload>): EventDefinition<TPayload> {
  return def;
}

export interface EventEnvelope<TPayload> {
  readonly eventId: string;
  readonly ownerId: OwnerId;
  readonly type: string;
  readonly schemaVersion: number;
  readonly aggregateId: string;
  readonly aggregateRevision: number;
  readonly occurredAt: string;
  readonly payload: TPayload;
}

export interface NewDomainEvent<TPayload> {
  readonly definition: EventDefinition<TPayload>;
  readonly aggregateId: string;
  readonly aggregateRevision: number;
  readonly payload: TPayload;
}

export interface EventPublisher {
  publish<TPayload>(event: NewDomainEvent<TPayload>, tx: WriteTx): Promise<void>;
}
