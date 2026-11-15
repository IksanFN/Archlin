import type { ColumnType, Generated } from 'kysely';

export type ReviewMode = 'none' | 'daily' | 'spaced';
export type SnapshotReason = 'idle' | 'leave' | 'manual' | 'pre_restore' | 'conflict' | 'import';

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
  created_at: Date;
}

export interface KnowledgeDatabase {
  kb_note_types: KbNoteTypesTable;
  kb_pages: KbPagesTable;
  kb_page_versions: KbPageVersionsTable;
}
