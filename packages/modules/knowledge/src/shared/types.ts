import type { TagRef } from '@archlin/platform/contracts';
import type { JSONContent } from '@tiptap/core';
import type { FieldDefinition } from './field-schema';
import type { ContextFields } from './inputs';

export interface NoteTypeRef {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  fieldSchema: FieldDefinition[];
  schemaVersion: number;
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
  properties: Record<string, unknown>;
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
