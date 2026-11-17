import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Static statements only.
const OWNER = `nullif(current_setting('app.owner_id', true), '')::uuid`;

const STATEMENTS = [
  `INSERT INTO public.entity_kinds (kind, module_id) VALUES ('kb.attachment', 'kb') ON CONFLICT (kind) DO NOTHING`,
  // extraction_error holds a code from a fixed list, never a library message that could quote the file (K7).
  `CREATE TABLE public.kb_attachments (
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    entity_id uuid NOT NULL,
    kind text NOT NULL DEFAULT 'kb.attachment' CHECK (kind = 'kb.attachment'),
    blob_sha256 text NOT NULL,
    upload_id uuid NOT NULL,
    filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
    mime text NOT NULL CHECK (char_length(mime) BETWEEN 3 AND 127),
    size bigint NOT NULL CHECK (size > 0),
    extraction_status text NOT NULL CHECK (extraction_status IN ('pending', 'done', 'no_text', 'unsupported', 'failed')),
    extraction_error text CHECK (extraction_error IN ('timeout', 'crashed', 'corrupt', 'archive_limits', 'blob_missing')),
    extracted_text text CHECK (char_length(extracted_text) <= 1000000),
    extraction_attempts int NOT NULL DEFAULT 0 CHECK (extraction_attempts >= 0),
    extraction_lease_until timestamptz,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (owner_id, entity_id),
    CONSTRAINT kb_attachments_upload_uk UNIQUE (owner_id, upload_id),
    CONSTRAINT kb_attachments_entity_fk FOREIGN KEY (owner_id, entity_id, kind)
      REFERENCES public.entities (owner_id, id, kind) ON DELETE CASCADE,
    CONSTRAINT kb_attachments_blob_fk FOREIGN KEY (owner_id, blob_sha256)
      REFERENCES public.blobs (owner_id, sha256) ON DELETE RESTRICT,
    CONSTRAINT kb_attachments_error_pair CHECK ((extraction_status = 'failed') = (extraction_error IS NOT NULL))
  )`,
  `CREATE INDEX kb_attachments_pending_idx ON public.kb_attachments (owner_id, created_at) WHERE extraction_status = 'pending'`,
  `CREATE INDEX kb_attachments_blob_idx ON public.kb_attachments (owner_id, blob_sha256)`,
  // Derived from the live content of each page on every save, so it can always be rebuilt from kb_pages.content.
  `CREATE TABLE public.kb_attachment_refs (
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    page_id uuid NOT NULL,
    attachment_id uuid NOT NULL,
    PRIMARY KEY (owner_id, page_id, attachment_id),
    CONSTRAINT kb_attachment_refs_page_fk FOREIGN KEY (owner_id, page_id)
      REFERENCES public.kb_pages (owner_id, entity_id) ON DELETE CASCADE,
    CONSTRAINT kb_attachment_refs_attachment_fk FOREIGN KEY (owner_id, attachment_id)
      REFERENCES public.kb_attachments (owner_id, entity_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX kb_attachment_refs_attachment_idx ON public.kb_attachment_refs (owner_id, attachment_id)`,
  // The same derivation per retained version, so an old version keeps its files from being cleaned up as orphans.
  `ALTER TABLE public.kb_page_versions ADD COLUMN attachment_ids uuid[] NOT NULL DEFAULT '{}'`,
  `CREATE INDEX kb_page_versions_attachments_idx ON public.kb_page_versions USING gin (attachment_ids)`,
  `ALTER TABLE public.kb_attachments ENABLE ROW LEVEL SECURITY`,
  `CREATE POLICY kb_attachments_owner ON public.kb_attachments FOR ALL TO cortex_app
     USING (owner_id = ${OWNER}) WITH CHECK (owner_id = ${OWNER})`,
  `ALTER TABLE public.kb_attachment_refs ENABLE ROW LEVEL SECURITY`,
  `CREATE POLICY kb_attachment_refs_owner ON public.kb_attachment_refs FOR ALL TO cortex_app
     USING (owner_id = ${OWNER}) WITH CHECK (owner_id = ${OWNER})`,
  `GRANT SELECT, INSERT, UPDATE ON public.kb_attachments TO cortex_app`,
  `GRANT SELECT, INSERT, DELETE ON public.kb_attachment_refs TO cortex_app`,
];

export const attachmentsMigration: Migration = {
  async up(db) {
    for (const statement of STATEMENTS) {
      await sql.raw(statement).execute(db);
    }
  },
};
