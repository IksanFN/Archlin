import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Static statements only.
const OWNER = `nullif(current_setting('app.owner_id', true), '')::uuid`;

// gc_marked_at is the first phase of collection: a blob is deleted only after it stayed unreferenced for a day past the mark.
const STATEMENTS = [
  `CREATE TABLE public.blobs (
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    size bigint NOT NULL CHECK (size > 0),
    created_at timestamptz NOT NULL,
    gc_marked_at timestamptz,
    PRIMARY KEY (owner_id, sha256)
  )`,
  `CREATE INDEX blobs_gc_marked_idx ON public.blobs (owner_id, gc_marked_at) WHERE gc_marked_at IS NOT NULL`,
  `ALTER TABLE public.blobs ENABLE ROW LEVEL SECURITY`,
  `CREATE POLICY blobs_owner ON public.blobs FOR ALL TO cortex_app
     USING (owner_id = ${OWNER}) WITH CHECK (owner_id = ${OWNER})`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON public.blobs TO cortex_app`,
];

export const blobsMigration: Migration = {
  async up(db) {
    for (const statement of STATEMENTS) {
      await sql.raw(statement).execute(db);
    }
  },
};
