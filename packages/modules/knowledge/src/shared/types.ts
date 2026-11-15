import type { Breadcrumb, InboundLink, OutboundLink, TagRef } from '@archlin/platform/contracts';
import type { JSONContent } from '@tiptap/core';
import type { FieldDefinition } from './field-schema';
import type { ContextFields, ReviewMode, SavePageInput, SnapshotReason } from './inputs';

export interface NoteTypeRef {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  fieldSchema: FieldDefinition[];
  schemaVersion: number;
}

export interface NoteTypeSummary extends NoteTypeRef {
  isSystem: boolean;
  defaultReviewMode: ReviewMode;
  revision: number;
  pageCount: number;
  trashedPageCount: number;
}

export interface NoteTypeDetail extends NoteTypeSummary {
  template: JSONContent;
}

export interface PageView {
  entityId: string;
  spaceId: string;
  spaceSlug: string;
  title: string;
  icon: string | null;
  isStarred: boolean;
  version: number;
  noteType: NoteTypeRef;
  content: JSONContent;
  context: ContextFields;
  properties: SavePageInput['properties'];
  missingRequired: string[];
  legacyKeys: string[];
  tags: TagRef[];
  createdAt: string;
  updatedAt: string;
  lastSavedAt: string;
  deletedAt: string | null;
  trashRootId: string | null;
  showContextNudge: boolean;
}

export type SaveResult = { status: 'saved' | 'unchanged'; version: number; savedAt: string };

export interface PageSuggestion {
  entityId: string;
  title: string;
  icon: string | null;
  spaceId: string;
  spaceSlug: string;
  spaceName: string;
}

export interface PageScreen {
  page: PageView;
  breadcrumbs: Breadcrumb[];
  linkTargets: OutboundLink[];
  backlinks: InboundLink[];
}

export type SnapshotResult =
  | { status: 'created'; versionId: string }
  | { status: 'unchanged'; versionId: string | null };

export interface VersionSummary {
  id: string;
  version: number;
  reason: SnapshotReason;
  label: string | null;
  createdAt: string;
}

export interface VersionPage {
  items: VersionSummary[];
  nextCursor: string | null;
}

export interface VersionDetail extends VersionSummary {
  title: string;
  content: JSONContent;
  contentText: string;
  context: ContextFields;
  properties: Record<string, unknown>;
  noteType: { id: string; name: string | null };
}

export interface RestoreVersionResult {
  version: number;
  savedAt: string;
  preRestoreVersionId: string | null;
}
