import type { Breadcrumb, TagRef } from '@archlin/platform/contracts';
import type { JSONContent } from '@tiptap/core';
import type { FieldDefinition } from './field-schema';
import type { ContextFields, ReviewMode, SavePageInput } from './inputs';

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

export interface PageScreen {
  page: PageView;
  breadcrumbs: Breadcrumb[];
}
