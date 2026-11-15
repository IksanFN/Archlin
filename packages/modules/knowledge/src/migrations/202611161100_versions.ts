import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

const STATEMENTS = [
  // Retention prunes old versions; M1 only granted SELECT and INSERT.
  `GRANT DELETE ON public.kb_page_versions TO cortex_app`,
  `CREATE INDEX kb_page_versions_page_order_idx ON public.kb_page_versions (owner_id, entity_id, created_at DESC, id DESC)`,
];

export const versionsMigration: Migration = {
  async up(db) {
    for (const statement of STATEMENTS) {
      await sql.raw(statement).execute(db);
    }
  },
};
