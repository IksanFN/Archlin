import { ownerOf, sqlFor } from '@archlin/db/scoped';
import { ConflictError, NotFoundError, ValidationError } from '@archlin/kernel';
import type { Clock, Ids, ReadTx, WriteTx } from '@archlin/kernel';
import type { EntitiesDatabase, TagService, TreeService } from '@archlin/platform/server';
import { normalizeTitle } from '@archlin/platform/server';
import type { JSONContent } from '@tiptap/core';
import { fieldSchemaSchema, legacyKeys, missingRequired, validateProperties } from '../shared/field-schema';
import type { FieldDefinition } from '../shared/field-schema';
import type {
  ChangeNoteTypeInput,
  ContextFields,
  CreatePageInput,
  OverwritePageInput,
  RenamePageInput,
  SavePageInput,
} from '../shared/inputs';
import type { PageView, SaveResult } from '../shared/types';
import { documentText, normalizeDocument, parseDocument } from './document';
import { pageStateHash, type PageState } from './hash';
import { PAGE_KIND } from './module';
import {
  asContent,
  asRecord,
  changedPageFields,
  contextOf,
  createPageWriter,
  jsonbValue,
  type LockedPage,
} from './page-writer';
import type { KnowledgeDatabase } from './schema';

type PageDatabase = KnowledgeDatabase & EntitiesDatabase;

const CONTEXT_NUDGE_MS = 24 * 60 * 60 * 1000;

export interface PageService {
  createPage(tx: WriteTx, input: CreatePageInput): Promise<{ entityId: string; spaceSlug: string }>;
  getPage(tx: ReadTx, entityId: string): Promise<PageView>;
  savePage(tx: WriteTx, input: SavePageInput): Promise<SaveResult>;
  renamePage(tx: WriteTx, input: RenamePageInput): Promise<{ version: number }>;
  changeNoteType(tx: WriteTx, input: ChangeNoteTypeInput): Promise<PageView>;
  saveConflictCopy(tx: WriteTx, input: SavePageInput): Promise<{ versionId: string }>;
  overwritePage(tx: WriteTx, input: OverwritePageInput): Promise<SaveResult>;
  summaries(tx: ReadTx, entityIds: readonly string[]): Promise<Map<string, string | null>>;
}

interface NoteTypeRow {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  template: unknown;
  fieldSchema: FieldDefinition[];
  schemaVersion: number;
}

interface PageViewRow {
  entity_id: string;
  note_type_id: string;
  content: unknown;
  properties: unknown;
  summary: string | null;
  when_to_use: string | null;
  source: string | null;
  aliases: string[];
  version: number;
  last_saved_at: Date;
  title: string;
  icon: string | null;
  is_starred: boolean;
  space_id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_root_id: string | null;
  space_slug: string;
  type_key: string;
  type_name: string;
  type_icon: string | null;
  field_schema: unknown;
  schema_version: number;
}

function dbOf(tx: ReadTx) {
  return sqlFor<PageDatabase>(tx);
}

function pageNotFound(): never {
  throw new NotFoundError('page_not_found', 'Halaman tidak ditemukan');
}

function noteTypeNotFound(): never {
  throw new NotFoundError('note_type_not_found', 'Tipe catatan tidak ditemukan');
}

function pageInTrash(): never {
  throw new ConflictError('page_in_trash', 'Halaman ini ada di Trash');
}

function pageConflict(currentVersion: number): never {
  throw new ConflictError('page_conflict', 'Halaman ini berubah di tab atau perangkat lain', { currentVersion });
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

function requireAlive(locked: LockedPage): void {
  if (locked.deletedAt !== null) pageInTrash();
}

function requireVersion(locked: LockedPage, expected: number): void {
  if (expected !== locked.version) pageConflict(locked.version);
}

function asProperties(value: SavePageInput['properties']): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function parseFields(value: unknown): FieldDefinition[] {
  // Zod optional keys include `| undefined`; FieldDefinition omits the property instead.
  return fieldSchemaSchema.parse(value) as FieldDefinition[];
}

function requireValidProperties(
  properties: Record<string, unknown>,
  previous: Record<string, unknown>,
  fieldSchema: FieldDefinition[],
): void {
  const issues = validateProperties(fieldSchema, properties, previous);
  if (issues.length > 0) {
    throw new ValidationError('invalid_input', 'Properti tidak valid', { issues });
  }
}

export function createPageService(deps: {
  tree: TreeService;
  tags: TagService;
  clock: Clock;
  ids: Ids;
}): PageService {
  const { tree, tags, clock, ids } = deps;
  const writer = createPageWriter({ tree, clock });

  async function loadNoteType(tx: ReadTx, noteTypeId: string): Promise<NoteTypeRow> {
    const row = await dbOf(tx)
      .selectFrom('kb_note_types')
      .selectAll()
      .where('id', '=', noteTypeId)
      .executeTakeFirst();
    if (!row) noteTypeNotFound();
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      icon: row.icon,
      template: row.template,
      fieldSchema: parseFields(row.field_schema),
      schemaVersion: row.schema_version,
    };
  }

  async function insertConflictVersion(
    tx: WriteTx,
    input: {
      entityId: string;
      version: number;
      title: string;
      content: JSONContent;
      contentText: string;
      contentHash: string;
      noteTypeId: string;
      noteTypeSchemaVersion: number;
      properties: Record<string, unknown>;
      context: ContextFields;
    },
  ): Promise<string> {
    const versionId = ids.uuidv7();
    await dbOf(tx)
      .insertInto('kb_page_versions')
      .values({
        id: versionId,
        owner_id: ownerOf(tx),
        entity_id: input.entityId,
        version: input.version,
        title: input.title,
        content: jsonbValue(input.content),
        content_text: input.contentText,
        content_hash: input.contentHash,
        note_type_id: input.noteTypeId,
        note_type_schema_version: input.noteTypeSchemaVersion,
        properties: jsonbValue(input.properties),
        summary: input.context.summary,
        when_to_use: input.context.whenToUse,
        source: input.context.source,
        aliases: [...input.context.aliases],
        reason: 'conflict',
        label: null,
        created_at: clock.now(),
      })
      .execute();
    return versionId;
  }

  async function getPage(tx: ReadTx, entityId: string): Promise<PageView> {
    const row = await dbOf(tx)
      .selectFrom('kb_pages as p')
      .innerJoin('entities as e', (join) =>
        join.onRef('e.id', '=', 'p.entity_id').onRef('e.owner_id', '=', 'p.owner_id'),
      )
      .innerJoin('spaces as s', (join) =>
        join.onRef('s.id', '=', 'e.space_id').onRef('s.owner_id', '=', 'e.owner_id'),
      )
      .innerJoin('kb_note_types as t', (join) =>
        join.onRef('t.id', '=', 'p.note_type_id').onRef('t.owner_id', '=', 'p.owner_id'),
      )
      .select([
        'p.entity_id',
        'p.note_type_id',
        'p.content',
        'p.properties',
        'p.summary',
        'p.when_to_use',
        'p.source',
        'p.aliases',
        'p.version',
        'p.last_saved_at',
        'e.title',
        'e.icon',
        'e.is_starred',
        'e.space_id',
        'e.created_at',
        'e.updated_at',
        'e.deleted_at',
        'e.deleted_root_id',
        's.slug as space_slug',
        't.key as type_key',
        't.name as type_name',
        't.icon as type_icon',
        't.field_schema',
        't.schema_version',
      ])
      .where('p.entity_id', '=', entityId)
      .executeTakeFirst();
    if (!row) pageNotFound();
    const view = row as PageViewRow;
    const fieldSchema = parseFields(view.field_schema);
    const properties = asRecord(view.properties) as PageView['properties'];
    const context = contextOf(view);
    const tagsForPage = await tags.forEntity(tx, entityId);
    return {
      entityId: view.entity_id,
      spaceId: view.space_id,
      spaceSlug: view.space_slug,
      title: view.title,
      icon: view.icon,
      isStarred: view.is_starred,
      version: view.version,
      noteType: {
        id: view.note_type_id,
        key: view.type_key,
        name: view.type_name,
        icon: view.type_icon,
        fieldSchema,
        schemaVersion: view.schema_version,
      },
      content: asContent(view.content),
      context,
      properties,
      missingRequired: missingRequired(fieldSchema, properties),
      legacyKeys: legacyKeys(fieldSchema, properties),
      tags: tagsForPage,
      createdAt: view.created_at.toISOString(),
      updatedAt: view.updated_at.toISOString(),
      lastSavedAt: view.last_saved_at.toISOString(),
      deletedAt: view.deleted_at?.toISOString() ?? null,
      trashRootId: view.deleted_root_id,
      showContextNudge:
        isBlank(context.summary) &&
        isBlank(context.whenToUse) &&
        clock.now().getTime() - view.created_at.getTime() > CONTEXT_NUDGE_MS,
    };
  }

  return {
    async createPage(tx, input) {
      const noteType = await loadNoteType(tx, input.noteTypeId);
      const entity = await tree.create(tx, {
        kind: PAGE_KIND,
        spaceId: input.spaceId,
        parentId: input.parentId,
        title: '',
        icon: null,
        placement: input.placement,
      });
      const content = normalizeDocument(noteType.template);
      const context: ContextFields = { summary: null, whenToUse: null, source: null, aliases: [] };
      const properties: Record<string, unknown> = {};
      const now = clock.now();
      await dbOf(tx)
        .insertInto('kb_pages')
        .values({
          owner_id: ownerOf(tx),
          entity_id: entity.id,
          kind: PAGE_KIND,
          note_type_id: noteType.id,
          content: jsonbValue(content),
          content_text: documentText(parseDocument(content)),
          content_hash: pageStateHash({
            title: entity.title,
            content,
            context,
            properties,
            noteTypeId: noteType.id,
          }),
          properties: jsonbValue(properties),
          summary: null,
          when_to_use: null,
          source: null,
          aliases: [],
          version: 1,
          last_saved_at: now,
          last_snapshot_at: null,
        })
        .execute();
      const space = await dbOf(tx).selectFrom('spaces').select('slug').where('id', '=', entity.spaceId).executeTakeFirst();
      if (!space) throw new NotFoundError('space_not_found', 'Space tidak ditemukan');
      return { entityId: entity.id, spaceSlug: space.slug };
    },

    getPage,

    async savePage(tx, input) {
      const locked = await writer.lockPage(tx, input.entityId);
      requireAlive(locked);
      const noteType = await loadNoteType(tx, locked.noteTypeId);
      const title = normalizeTitle(input.title);
      const content = normalizeDocument(input.content);
      const properties = asProperties(input.properties);
      requireValidProperties(properties, locked.properties, noteType.fieldSchema);
      const next: PageState = {
        title,
        content,
        context: input.context,
        properties,
        noteTypeId: locked.noteTypeId,
      };
      if (pageStateHash(next) === locked.contentHash) {
        return { status: 'unchanged', version: locked.version, savedAt: locked.lastSavedAt };
      }
      requireVersion(locked, input.baseVersion);
      return writer.writePage(tx, locked, next, changedPageFields(locked, next));
    },

    async renamePage(tx, input) {
      const locked = await writer.lockPage(tx, input.entityId);
      requireAlive(locked);
      const title = normalizeTitle(input.title);
      if (title === locked.title) return { version: locked.version };
      const next: PageState = {
        title,
        content: locked.content,
        context: locked.context,
        properties: locked.properties,
        noteTypeId: locked.noteTypeId,
      };
      const saved = await writer.writePage(tx, locked, next, ['title']);
      return { version: saved.version };
    },

    async changeNoteType(tx, input) {
      const locked = await writer.lockPage(tx, input.entityId);
      requireAlive(locked);
      requireVersion(locked, input.baseVersion);
      const noteType = await loadNoteType(tx, input.noteTypeId);
      if (noteType.id !== locked.noteTypeId) {
        const next: PageState = {
          title: locked.title,
          content: locked.content,
          context: locked.context,
          properties: locked.properties,
          noteTypeId: noteType.id,
        };
        await writer.writePage(tx, locked, next, ['noteType']);
      }
      return getPage(tx, input.entityId);
    },

    async saveConflictCopy(tx, input) {
      const locked = await writer.lockPage(tx, input.entityId);
      const noteType = await loadNoteType(tx, locked.noteTypeId);
      const title = normalizeTitle(input.title);
      const content = normalizeDocument(input.content);
      const properties = asProperties(input.properties);
      requireValidProperties(properties, locked.properties, noteType.fieldSchema);
      const next: PageState = {
        title,
        content,
        context: input.context,
        properties,
        noteTypeId: locked.noteTypeId,
      };
      const versionId = await insertConflictVersion(tx, {
        entityId: locked.entityId,
        version: input.baseVersion,
        title,
        content,
        contentText: documentText(parseDocument(content)),
        contentHash: pageStateHash(next),
        noteTypeId: locked.noteTypeId,
        noteTypeSchemaVersion: noteType.schemaVersion,
        properties,
        context: input.context,
      });
      return { versionId };
    },

    async overwritePage(tx, input) {
      const locked = await writer.lockPage(tx, input.entityId);
      requireAlive(locked);
      if (locked.version !== input.seenVersion) pageConflict(locked.version);
      const noteType = await loadNoteType(tx, locked.noteTypeId);
      const title = normalizeTitle(input.title);
      const content = normalizeDocument(input.content);
      const properties = asProperties(input.properties);
      requireValidProperties(properties, locked.properties, noteType.fieldSchema);
      await insertConflictVersion(tx, {
        entityId: locked.entityId,
        version: locked.version,
        title: locked.title,
        content: locked.content,
        contentText: locked.contentText,
        contentHash: locked.contentHash,
        noteTypeId: locked.noteTypeId,
        noteTypeSchemaVersion: noteType.schemaVersion,
        properties: locked.properties,
        context: locked.context,
      });
      const next: PageState = {
        title,
        content,
        context: input.context,
        properties,
        noteTypeId: locked.noteTypeId,
      };
      return writer.writePage(tx, locked, next, changedPageFields(locked, next));
    },

    async summaries(tx, entityIds) {
      const summaries = new Map<string, string | null>();
      if (entityIds.length === 0) return summaries;
      const rows = await dbOf(tx)
        .selectFrom('kb_pages')
        .select(['entity_id', 'summary'])
        .where('entity_id', 'in', [...entityIds])
        .execute();
      for (const row of rows) summaries.set(row.entity_id, row.summary);
      return summaries;
    },
  };
}
