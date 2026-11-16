import type { ColumnType, Generated } from 'kysely';
import type { ExtractionStatus } from '../shared/attachment-kind';
import type { SnapshotReason } from '../shared/inputs';

export type ExtractionError = 'timeout' | 'crashed' | 'corrupt' | 'archive_limits' | 'blob_missing';

export type ReviewMode = 'none' | 'daily' | 'spaced';

export interface KbNoteTypesTable {
  id: string;
  owner_id: string;
  key: string;
  name: string;
  icon: string | null;
  template: ColumnType<unknown, string, string>;
  field_schema: ColumnType<unknown, string, string>;
  schema_version: Generated<number>;
  revision: Generated<number>;
  default_review_mode: ReviewMode;
  is_system: Generated<boolean>;
  position: string;
  created_at: Date;
  updated_at: Date;
}

export interface KbPagesTable {
  owner_id: string;
  entity_id: string;
  kind: Generated<string>;
  note_type_id: string;
  content: unknown;
  content_text: string;
  content_hash: string;
  properties: Generated<unknown>;
  summary: string | null;
  when_to_use: string | null;
  source: string | null;
  aliases: Generated<string[]>;
  version: Generated<number>;
  last_saved_at: Date;
  last_snapshot_at: Date | null;
}

export interface KbPageVersionsTable {
  id: string;
  owner_id: string;
  entity_id: string;
  version: number;
  title: string;
  content: unknown;
  content_text: string;
  content_hash: string;
  note_type_id: string;
  note_type_schema_version: number;
  properties: unknown;
  summary: string | null;
  when_to_use: string | null;
  source: string | null;
  aliases: string[];
  reason: SnapshotReason;
  label: string | null;
  attachment_ids: Generated<string[]>;
  created_at: Date;
}

export interface KbAttachmentsTable {
  owner_id: string;
  entity_id: string;
  kind: Generated<string>;
  blob_sha256: string;
  upload_id: string;
  filename: string;
  mime: string;
  size: ColumnType<string, number, never>;
  extraction_status: ExtractionStatus;
  extraction_error: ExtractionError | null;
  extracted_text: string | null;
  extraction_attempts: Generated<number>;
  extraction_lease_until: Date | null;
  created_at: Date;
}

export interface KbAttachmentRefsTable {
  owner_id: string;
  page_id: string;
  attachment_id: string;
}

export interface KnowledgeDatabase {
  kb_note_types: KbNoteTypesTable;
  kb_pages: KbPagesTable;
  kb_page_versions: KbPageVersionsTable;
  kb_attachments: KbAttachmentsTable;
  kb_attachment_refs: KbAttachmentRefsTable;
}
