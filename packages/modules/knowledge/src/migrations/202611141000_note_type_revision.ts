import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

const STATEMENTS = [
  `ALTER TABLE public.kb_note_types ADD COLUMN revision int NOT NULL DEFAULT 1 CHECK (revision >= 1)`,
];

export const noteTypeRevisionMigration: Migration = {
  async up(db) {
    for (const statement of STATEMENTS) {
      await sql.raw(statement).execute(db);
    }
  },
};
