import type { NamespacedMigrations } from '@archlin/db/migrations';
import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

const OWNER_COLUMN = 'owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE';

const TABLES = {
  fixture_sync_marks: 'aggregate_id uuid NOT NULL, PRIMARY KEY (owner_id, aggregate_id)',
  fixture_pings: 'event_id uuid NOT NULL, received_count int NOT NULL DEFAULT 1, PRIMARY KEY (owner_id, event_id)',
  fixture_audit: 'event_id uuid NOT NULL, PRIMARY KEY (owner_id, event_id)',
  fixture_switches: 'fail_ping boolean NOT NULL DEFAULT false, fail_audit boolean NOT NULL DEFAULT false, PRIMARY KEY (owner_id)',
} as const;

const tables: Migration = {
  async up(db) {
    for (const [table, columns] of Object.entries(TABLES)) {
      await sql.raw(`CREATE TABLE public.${table} (${OWNER_COLUMN}, ${columns})`).execute(db);
      await sql.raw(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`).execute(db);
      await sql
        .raw(
          `CREATE POLICY ${table}_owner ON public.${table} FOR ALL TO cortex_app
             USING (owner_id = nullif(current_setting('app.owner_id', true), '')::uuid)
             WITH CHECK (owner_id = nullif(current_setting('app.owner_id', true), '')::uuid)`,
        )
        .execute(db);
      await sql.raw(`GRANT SELECT, INSERT, UPDATE ON public.${table} TO cortex_app`).execute(db);
    }
  },
};

export const fixtureMigrations: NamespacedMigrations = {
  namespace: 'fixture',
  migrations: { '202611111300_tables': tables },
};
