import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Catalog, spaces, entities and tags. Static statements only.
const OWNER = `nullif(current_setting('app.owner_id', true), '')::uuid`;

const STATEMENTS = [
  `CREATE TABLE public.entity_kinds (
    kind text PRIMARY KEY CHECK (kind ~ '^[a-z][a-z0-9]{1,15}\\.[a-z][a-zA-Z0-9]{0,47}$'),
    module_id text NOT NULL CHECK (kind LIKE module_id || '.%')
  )`,

  `CREATE TABLE public.spaces (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 64),
    icon text CHECK (char_length(icon) BETWEEN 1 AND 16),
    position text COLLATE "C" NOT NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, archived_at timestamptz,
    CONSTRAINT spaces_owner_id_uk UNIQUE (owner_id, id),
    CONSTRAINT spaces_owner_slug_uk UNIQUE (owner_id, slug),
    CONSTRAINT spaces_owner_position_uk UNIQUE (owner_id, position)
  )`,

  `CREATE TABLE public.entities (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    kind text NOT NULL REFERENCES public.entity_kinds (kind),
    space_id uuid NOT NULL,
    parent_id uuid,
    position text COLLATE "C" NOT NULL,
    title text NOT NULL CHECK (char_length(title) <= 500),
    icon text CHECK (char_length(icon) BETWEEN 1 AND 16),
    is_starred boolean NOT NULL DEFAULT false,
    last_viewed_at timestamptz, view_count int NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    revision int NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
    deleted_at timestamptz, deleted_root_id uuid,
    CONSTRAINT entities_owner_id_uk UNIQUE (owner_id, id),
    CONSTRAINT entities_owner_space_id_uk UNIQUE (owner_id, space_id, id),
    CONSTRAINT entities_owner_id_kind_uk UNIQUE (owner_id, id, kind),
    CONSTRAINT entities_space_fk FOREIGN KEY (owner_id, space_id) REFERENCES public.spaces (owner_id, id),
    -- The parent must sit in the same space; a space change cascades down the subtree and a purged parent releases its child.
    CONSTRAINT entities_parent_fk FOREIGN KEY (owner_id, space_id, parent_id)
      REFERENCES public.entities (owner_id, space_id, id) ON UPDATE CASCADE ON DELETE SET NULL (parent_id),
    CONSTRAINT entities_deleted_root_fk FOREIGN KEY (owner_id, deleted_root_id)
      REFERENCES public.entities (owner_id, id) ON DELETE SET NULL (deleted_root_id),
    CONSTRAINT entities_not_own_parent CHECK (parent_id IS DISTINCT FROM id),
    CONSTRAINT entities_trash_pair CHECK ((deleted_at IS NULL) = (deleted_root_id IS NULL))
  )`,
  `CREATE UNIQUE INDEX entities_sibling_position_uk ON public.entities (owner_id, space_id, parent_id, position)
    NULLS NOT DISTINCT WHERE deleted_at IS NULL`,
  `CREATE INDEX entities_trash_root_idx ON public.entities (owner_id, deleted_root_id) WHERE deleted_at IS NOT NULL`,
  `CREATE INDEX entities_space_updated_idx ON public.entities (owner_id, space_id, updated_at DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX entities_starred_idx ON public.entities (owner_id) WHERE is_starred AND deleted_at IS NULL`,
  `CREATE INDEX entities_kind_idx ON public.entities (kind)`,

  `CREATE TABLE public.tags (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 48),
    color text,
    created_at timestamptz NOT NULL,
    CONSTRAINT tags_owner_id_uk UNIQUE (owner_id, id)
  )`,
  `CREATE UNIQUE INDEX tags_owner_name_uk ON public.tags (owner_id, lower(name))`,

  `CREATE TABLE public.entity_tags (
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    entity_id uuid NOT NULL, tag_id uuid NOT NULL,
    PRIMARY KEY (owner_id, entity_id, tag_id),
    FOREIGN KEY (owner_id, entity_id) REFERENCES public.entities (owner_id, id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id, tag_id) REFERENCES public.tags (owner_id, id) ON DELETE CASCADE
  )`,

  ...['spaces', 'entities', 'tags', 'entity_tags'].flatMap((table) => [
    `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY ${table}_owner ON public.${table} FOR ALL TO cortex_app
       USING (owner_id = ${OWNER}) WITH CHECK (owner_id = ${OWNER})`,
  ]),

  `GRANT SELECT ON public.entity_kinds TO cortex_app`,
  `GRANT SELECT, INSERT, UPDATE ON public.spaces TO cortex_app`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON public.entities TO cortex_app`,
  `GRANT SELECT, INSERT ON public.tags TO cortex_app`,
  `GRANT SELECT, INSERT, DELETE ON public.entity_tags TO cortex_app`,
];

export const entitiesMigration: Migration = {
  async up(db) {
    for (const statement of STATEMENTS) {
      await sql.raw(statement).execute(db);
    }
  },
};
