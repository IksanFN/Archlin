import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Transactional outbox with one delivery row per async handler. Static statements only.
const STATEMENTS = [
  `CREATE TABLE public.outbox_events (
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    event_id uuid NOT NULL,
    type text NOT NULL,
    schema_version int NOT NULL CHECK (schema_version > 0),
    aggregate_id uuid NOT NULL,
    aggregate_revision int NOT NULL CHECK (aggregate_revision >= 0),
    occurred_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (owner_id, event_id)
  )`,

  // Receipt of a handler: the delivery row turns 'completed' in the same transaction as the handler's own effect.
  `CREATE TABLE public.outbox_deliveries (
    owner_id uuid NOT NULL,
    event_id uuid NOT NULL,
    handler_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('ready', 'enqueued', 'completed', 'blocked')),
    attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL,
    enqueued_at timestamptz,
    completed_at timestamptz,
    last_error_code text,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (owner_id, event_id, handler_id),
    FOREIGN KEY (owner_id, event_id) REFERENCES public.outbox_events (owner_id, event_id) ON DELETE CASCADE,
    CHECK (status <> 'enqueued' OR enqueued_at IS NOT NULL),
    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
    CHECK (status <> 'blocked' OR last_error_code IS NOT NULL)
  )`,
  `CREATE INDEX outbox_deliveries_ready_idx ON public.outbox_deliveries (owner_id, next_attempt_at) WHERE status = 'ready'`,
  `CREATE INDEX outbox_deliveries_enqueued_idx ON public.outbox_deliveries (owner_id, enqueued_at) WHERE status = 'enqueued'`,

  ...['outbox_events', 'outbox_deliveries'].flatMap((table) => [
    `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY ${table}_owner ON public.${table} FOR ALL TO cortex_app
       USING (owner_id = nullif(current_setting('app.owner_id', true), '')::uuid)
       WITH CHECK (owner_id = nullif(current_setting('app.owner_id', true), '')::uuid)`,
  ]),
  `GRANT SELECT, INSERT ON public.outbox_events TO cortex_app`,
  `GRANT SELECT, INSERT, UPDATE ON public.outbox_deliveries TO cortex_app`,
];

export const outboxMigration: Migration = {
  async up(db) {
    for (const statement of STATEMENTS) {
      await sql.raw(statement).execute(db);
    }
  },
};
