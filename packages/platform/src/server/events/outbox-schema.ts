import type { ColumnType, Generated } from 'kysely';

export type DeliveryStatus = 'ready' | 'enqueued' | 'completed' | 'blocked';

// Kysely table types for the outbox tables (migration 202611111210_outbox). Timestamps are read as Date and written
// as ISO strings, which is how the application Clock hands them over.
type Timestamp = ColumnType<Date, string, string>;
type NullableTimestamp = ColumnType<Date | null, string | null | undefined, string | null>;

export interface OutboxEventsTable {
  owner_id: string;
  event_id: string;
  type: string;
  schema_version: number;
  aggregate_id: string;
  aggregate_revision: number;
  occurred_at: Timestamp;
  // Read as parsed JSON, written as a JSON string.
  payload: ColumnType<unknown, string, string>;
}

export interface OutboxDeliveriesTable {
  owner_id: string;
  event_id: string;
  handler_id: string;
  status: DeliveryStatus;
  attempts: Generated<number>;
  next_attempt_at: Timestamp;
  enqueued_at: NullableTimestamp;
  completed_at: NullableTimestamp;
  last_error_code: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, string, never>;
}

export interface OutboxDatabase {
  outbox_events: OutboxEventsTable;
  outbox_deliveries: OutboxDeliveriesTable;
}
