import { systemIds } from '@archlin/kernel';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { KnowledgeDatabase } from '../server/schema';
import { seedSystemNoteTypes } from '../server/seed';

const OWNER = `nullif(current_setting('app.owner_id', true), '')::uuid`;

const STATEMENTS = [
  `INSERT INTO public.entity_kinds (kind, module_id) VALUES ('kb.page', 'kb') ON CONFLICT (kind) DO NOTHING`,

  `CREATE TABLE public.kb_note_types (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    icon text CHECK (char_length(icon) BETWEEN 1 AND 16),
    template jsonb NOT NULL CHECK (jsonb_typeof(template) = 'object'),
    field_schema jsonb NOT NULL CHECK (jsonb_typeof(field_schema) = 'array'),
    schema_version int NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
    default_review_mode text NOT NULL CHECK (default_review_mode IN ('none', 'daily', 'spaced')),
    is_system boolean NOT NULL DEFAULT false,
    position text COLLATE "C" NOT NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
    CONSTRAINT kb_note_types_owner_id_uk UNIQUE (owner_id, id),
    CONSTRAINT kb_note_types_owner_key_uk UNIQUE (owner_id, key),
    CONSTRAINT kb_note_types_owner_position_uk UNIQUE (owner_id, position)
  )`,

  `CREATE TABLE public.kb_pages (
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    entity_id uuid NOT NULL,
    kind text NOT NULL DEFAULT 'kb.page' CHECK (kind = 'kb.page'),
    note_type_id uuid NOT NULL,
    content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
    content_text text NOT NULL,
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    properties jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(properties) = 'object'),
    summary text CHECK (char_length(summary) <= 1000),
    when_to_use text CHECK (char_length(when_to_use) <= 1000),
    source text CHECK (char_length(source) <= 500),
    aliases text[] NOT NULL DEFAULT '{}' CHECK (cardinality(aliases) <= 20),
    version int NOT NULL DEFAULT 1 CHECK (version >= 1),
    last_saved_at timestamptz NOT NULL,
    last_snapshot_at timestamptz,
    PRIMARY KEY (owner_id, entity_id),
    CONSTRAINT kb_pages_entity_fk FOREIGN KEY (owner_id, entity_id, kind) REFERENCES public.entities (owner_id, id, kind) ON DELETE CASCADE,
    CONSTRAINT kb_pages_note_type_fk FOREIGN KEY (owner_id, note_type_id) REFERENCES public.kb_note_types (owner_id, id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX kb_pages_note_type_idx ON public.kb_pages (owner_id, note_type_id)`,

  `CREATE TABLE public.kb_page_versions (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    entity_id uuid NOT NULL,
    version int NOT NULL CHECK (version >= 1),
    title text NOT NULL, content jsonb NOT NULL, content_text text NOT NULL,
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    note_type_id uuid NOT NULL, note_type_schema_version int NOT NULL,
    properties jsonb NOT NULL, summary text, when_to_use text, source text, aliases text[] NOT NULL,
    reason text NOT NULL CHECK (reason IN ('idle', 'leave', 'manual', 'pre_restore', 'conflict', 'import')),
    label text CHECK (char_length(label) <= 80),
    created_at timestamptz NOT NULL,
    CONSTRAINT kb_page_versions_owner_id_uk UNIQUE (owner_id, id),
    CONSTRAINT kb_page_versions_page_fk FOREIGN KEY (owner_id, entity_id) REFERENCES public.kb_pages (owner_id, entity_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX kb_page_versions_page_idx ON public.kb_page_versions (owner_id, entity_id, created_at DESC)`,

  ...['kb_note_types', 'kb_pages', 'kb_page_versions'].flatMap((table) => [
    `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY ${table}_owner ON public.${table} FOR ALL TO cortex_app
       USING (owner_id = ${OWNER}) WITH CHECK (owner_id = ${OWNER})`,
  ]),

  `GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_note_types TO cortex_app`,
  `GRANT SELECT, INSERT, UPDATE ON public.kb_pages TO cortex_app`,
  `GRANT SELECT, INSERT ON public.kb_page_versions TO cortex_app`,
];

export const knowledgeMigration: Migration = {
  async up(db) {
    for (const statement of STATEMENTS) {
      await sql.raw(statement).execute(db);
    }
    const accounts = await sql<{ id: string }>`select id from public.users`.execute(db);
    const now = new Date();
    for (const account of accounts.rows) {
      await seedSystemNoteTypes(db as unknown as Kysely<KnowledgeDatabase>, account.id, systemIds, now);
    }
  },
};
