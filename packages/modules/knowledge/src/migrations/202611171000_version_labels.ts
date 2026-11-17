import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

const STATEMENTS = [
  // "Save version" on a state an automatic version already holds keeps that version as manual and names it, so the
  // state outlives retention. Only these two columns: a stored snapshot itself never changes.
  `GRANT UPDATE (reason, label) ON public.kb_page_versions TO cortex_app`,
];

export const versionLabelsMigration: Migration = {
  async up(db) {
    for (const statement of STATEMENTS) {
      await sql.raw(statement).execute(db);
    }
  },
};
