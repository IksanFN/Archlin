import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Static statements only.
const OWNER = `nullif(current_setting('app.owner_id', true), '')::uuid`;

// resolved_by: 'id' = the node carried a valid id, 'title' = resolved by title on the server, 'none' = unresolved.
const STATEMENTS = [
  `CREATE TABLE public.links (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    source_id uuid NOT NULL,
    target_id uuid,
    target_title text NOT NULL CHECK (char_length(target_title) BETWEEN 1 AND 500),
    target_key text GENERATED ALWAYS AS (lower(target_title)) STORED,
    kind text NOT NULL CHECK (kind IN ('wikilink', 'mention')),
    resolved_by text NOT NULL CHECK (resolved_by IN ('id', 'title', 'none')),
    snippet text NOT NULL CHECK (char_length(snippet) <= 240),
    position int NOT NULL CHECK (position >= 0),
    created_at timestamptz NOT NULL,
    CONSTRAINT links_owner_id_uk UNIQUE (owner_id, id),
    CONSTRAINT links_source_fk FOREIGN KEY (owner_id, source_id)
      REFERENCES public.entities (owner_id, id) ON DELETE CASCADE,
    CONSTRAINT links_target_fk FOREIGN KEY (owner_id, target_id)
      REFERENCES public.entities (owner_id, id) ON DELETE SET NULL (target_id)
  )`,
  `CREATE INDEX links_source_idx ON public.links (owner_id, source_id, position)`,
  `CREATE INDEX links_target_idx ON public.links (owner_id, target_id) WHERE target_id IS NOT NULL`,
  `CREATE INDEX links_pending_idx ON public.links (owner_id, target_key) WHERE target_id IS NULL`,
  `ALTER TABLE public.links ENABLE ROW LEVEL SECURITY`,
  `CREATE POLICY links_owner ON public.links FOR ALL TO cortex_app
     USING (owner_id = ${OWNER}) WITH CHECK (owner_id = ${OWNER})`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON public.links TO cortex_app`,
];

export const linksMigration: Migration = {
  async up(db) {
    for (const statement of STATEMENTS) {
      await sql.raw(statement).execute(db);
    }
  },
};
