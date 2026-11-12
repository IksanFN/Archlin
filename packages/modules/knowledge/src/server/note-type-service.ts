import { ownerOf, sqlFor } from '@archlin/db/scoped';
import { ConflictError, NotFoundError, ValidationError } from '@archlin/kernel';
import type { Clock, EventPublisher, Ids, ReadTx, WriteTx } from '@archlin/kernel';
import type { ReorderInput } from '@archlin/platform/contracts';
import type { EntitiesDatabase, TreeService } from '@archlin/platform/server';
import { generateKeyBetween } from 'fractional-indexing';
import { sql, type Selectable } from 'kysely';
import { canonicalJson } from '../shared/canonical-json';
import { fieldSchemaSchema } from '../shared/field-schema';
import type { FieldDefinition } from '../shared/field-schema';
import type { CreateNoteTypeInput, DeleteNoteTypeInput, UpdateNoteTypeInput } from '../shared/inputs';
import type { NoteTypeDetail, NoteTypeSummary } from '../shared/types';
import { deriveTypeKey } from '../shared/type-key';
import { parseDocument } from './document';
import { noteTypeUpdated } from './module';
import { asContent, createPageWriter, jsonbValue } from './page-writer';
import type { KnowledgeDatabase } from './schema';

type NoteTypeDatabase = KnowledgeDatabase & EntitiesDatabase;
type NoteTypeRow = Selectable<NoteTypeDatabase['kb_note_types']>;

export interface NoteTypeService {
  list(tx: ReadTx): Promise<NoteTypeSummary[]>;
  get(tx: ReadTx, id: string): Promise<NoteTypeDetail>;
  create(tx: WriteTx, input: CreateNoteTypeInput): Promise<NoteTypeDetail>;
  update(tx: WriteTx, input: UpdateNoteTypeInput): Promise<NoteTypeDetail>;
  reorder(tx: WriteTx, input: ReorderInput): Promise<void>;
  remove(tx: WriteTx, input: DeleteNoteTypeInput): Promise<{ reassigned: number }>;
}

function dbOf(tx: ReadTx) {
  return sqlFor<NoteTypeDatabase>(tx);
}

function noteTypeNotFound(): never {
  throw new NotFoundError('note_type_not_found', 'Tipe catatan tidak ditemukan');
}

function parseFields(value: unknown): FieldDefinition[] {
  // Zod optional keys include `| undefined`; FieldDefinition omits the property instead.
  return fieldSchemaSchema.parse(value) as FieldDefinition[];
}

function toSummary(row: NoteTypeRow, pageCount: number): NoteTypeSummary {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    icon: row.icon,
    fieldSchema: parseFields(row.field_schema),
    schemaVersion: row.schema_version,
    isSystem: row.is_system,
    defaultReviewMode: row.default_review_mode,
    pageCount,
  };
}

function toDetail(row: NoteTypeRow, pageCount: number): NoteTypeDetail {
  return { ...toSummary(row, pageCount), template: asContent(row.template) };
}

function assertFieldTypesImmutable(previous: readonly FieldDefinition[], next: readonly FieldDefinition[]): void {
  const previousType = new Map(previous.map((field) => [field.key, field.type]));
  const issues: { path: string; message: string }[] = [];
  for (let i = 0; i < next.length; i += 1) {
    const field = next[i];
    if (field === undefined) continue;
    const stored = previousType.get(field.key);
    if (stored !== undefined && stored !== field.type) {
      issues.push({ path: `fieldSchema.${i}.type`, message: 'field_type_immutable' });
    }
  }
  if (issues.length > 0) {
    throw new ValidationError('invalid_input', 'Skema field tidak valid', { issues });
  }
}

export function createNoteTypeService(deps: {
  tree: TreeService;
  publisher: EventPublisher;
  clock: Clock;
  ids: Ids;
}): NoteTypeService {
  const { tree, publisher, clock, ids } = deps;
  const writer = createPageWriter({ tree, clock });

  async function livingPageCounts(tx: ReadTx, typeIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>(typeIds.map((id) => [id, 0]));
    if (typeIds.length === 0) return counts;
    const rows = await dbOf(tx)
      .selectFrom('kb_pages as p')
      .innerJoin('entities as e', (join) =>
        join.onRef('e.id', '=', 'p.entity_id').onRef('e.owner_id', '=', 'p.owner_id'),
      )
      .select('p.note_type_id')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('e.deleted_at', 'is', null)
      .where('p.note_type_id', 'in', [...typeIds])
      .groupBy('p.note_type_id')
      .execute();
    for (const row of rows) counts.set(row.note_type_id, row.n);
    return counts;
  }

  async function loadById(tx: ReadTx, id: string, mode: 'read' | 'write' = 'read'): Promise<NoteTypeRow> {
    const query = dbOf(tx).selectFrom('kb_note_types').selectAll().where('id', '=', id);
    const row = await (mode === 'write' ? query.forUpdate() : query).executeTakeFirst();
    if (!row) noteTypeNotFound();
    return row;
  }

  async function detailOf(tx: ReadTx, row: NoteTypeRow): Promise<NoteTypeDetail> {
    const counts = await livingPageCounts(tx, [row.id]);
    return toDetail(row, counts.get(row.id) ?? 0);
  }

  return {
    async list(tx) {
      const rows = await dbOf(tx).selectFrom('kb_note_types').selectAll().orderBy('position').execute();
      const counts = await livingPageCounts(
        tx,
        rows.map((row) => row.id),
      );
      return rows.map((row) => toSummary(row, counts.get(row.id) ?? 0));
    },

    async get(tx, id) {
      return detailOf(tx, await loadById(tx, id));
    },

    async create(tx, input) {
      parseDocument(input.template);
      const fieldSchema = parseFields(input.fieldSchema);
      const name = input.name.trim();
      const db = dbOf(tx);
      const rows = await db.selectFrom('kb_note_types').select(['key', 'position']).forUpdate().orderBy('position').execute();
      const taken = new Set(rows.map((row) => row.key));
      const last = rows[rows.length - 1];
      const now = clock.now();
      const row = await db
        .insertInto('kb_note_types')
        .values({
          id: ids.uuidv7(),
          owner_id: ownerOf(tx),
          key: deriveTypeKey(name, taken),
          name,
          icon: input.icon,
          template: jsonbValue(input.template),
          field_schema: jsonbValue(fieldSchema),
          schema_version: 1,
          default_review_mode: input.defaultReviewMode,
          is_system: false,
          position: generateKeyBetween(last?.position ?? null, null),
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new Error('insert into kb_note_types returned no row');
      return toDetail(row, 0);
    },

    async update(tx, input) {
      const current = await loadById(tx, input.id, 'write');
      if (input.baseSchemaVersion !== current.schema_version) {
        throw new ConflictError('note_type_conflict', 'Tipe catatan ini berubah di tab atau perangkat lain', {
          currentSchemaVersion: current.schema_version,
        });
      }
      const currentFields = parseFields(current.field_schema);
      const nextFields = input.fieldSchema !== undefined ? parseFields(input.fieldSchema) : currentFields;
      if (input.fieldSchema !== undefined) assertFieldTypesImmutable(currentFields, nextFields);
      if (input.template !== undefined) parseDocument(input.template);
      const fieldsChanged = canonicalJson(nextFields) !== canonicalJson(currentFields);
      const schemaVersion = fieldsChanged ? current.schema_version + 1 : current.schema_version;
      const row = await dbOf(tx)
        .updateTable('kb_note_types')
        .set({
          name: input.name !== undefined ? input.name.trim() : current.name,
          icon: input.icon !== undefined ? input.icon : current.icon,
          template: jsonbValue(input.template !== undefined ? input.template : current.template),
          field_schema: jsonbValue(nextFields),
          schema_version: schemaVersion,
          default_review_mode:
            input.defaultReviewMode !== undefined ? input.defaultReviewMode : current.default_review_mode,
          updated_at: clock.now(),
        })
        .where('id', '=', input.id)
        .returningAll()
        .executeTakeFirst();
      if (!row) noteTypeNotFound();
      await publisher.publish(
        {
          definition: noteTypeUpdated,
          aggregateId: row.id,
          aggregateRevision: row.schema_version,
          payload: { fieldsChanged },
        },
        tx,
      );
      return detailOf(tx, row);
    },

    async reorder(tx, input) {
      const rows = await dbOf(tx)
        .selectFrom('kb_note_types')
        .select(['id', 'position'])
        .orderBy('position')
        .forUpdate()
        .execute();
      const current = rows.find((row) => row.id === input.id);
      if (!current) noteTypeNotFound();
      const others = rows.filter((row) => row.id !== input.id);

      let position: string;
      if (input.afterId !== null) {
        const afterIndex = others.findIndex((row) => row.id === input.afterId);
        const after = others[afterIndex];
        if (afterIndex < 0 || after === undefined) noteTypeNotFound();
        const next = others[afterIndex + 1];
        position = generateKeyBetween(after.position, next?.position ?? null);
      } else if (input.beforeId !== null) {
        const beforeIndex = others.findIndex((row) => row.id === input.beforeId);
        const before = others[beforeIndex];
        if (beforeIndex < 0 || before === undefined) noteTypeNotFound();
        const prev = others[beforeIndex - 1];
        position = generateKeyBetween(prev?.position ?? null, before.position);
      } else {
        const last = others[others.length - 1];
        position = generateKeyBetween(last?.position ?? null, null);
      }

      await dbOf(tx)
        .updateTable('kb_note_types')
        .set({ position, updated_at: clock.now() })
        .where('id', '=', input.id)
        .execute();
    },

    async remove(tx, input) {
      const current = await loadById(tx, input.id, 'write');
      if (current.is_system) {
        throw new ValidationError('system_type_locked', 'Tipe sistem tidak dapat dihapus');
      }
      if (input.reassignTo !== null) {
        if (input.reassignTo === input.id) {
          throw new ValidationError('invalid_reassign_target', 'Tipe tujuan tidak valid');
        }
        const target = await dbOf(tx)
          .selectFrom('kb_note_types')
          .select('id')
          .where('id', '=', input.reassignTo)
          .executeTakeFirst();
        if (!target) throw new ValidationError('invalid_reassign_target', 'Tipe tujuan tidak valid');
      }
      const pages = await dbOf(tx)
        .selectFrom('kb_pages')
        .select('entity_id')
        .where('note_type_id', '=', input.id)
        .orderBy('entity_id')
        .execute();
      if (pages.length > 0 && input.reassignTo === null) {
        throw new ConflictError('note_type_in_use', 'Tipe catatan masih dipakai halaman', { pageCount: pages.length });
      }
      if (input.reassignTo !== null) {
        for (const page of pages) {
          const locked = await writer.lockPage(tx, page.entity_id);
          const next = {
            title: locked.title,
            content: locked.content,
            context: locked.context,
            properties: locked.properties,
            noteTypeId: input.reassignTo,
          };
          // Trash pages must not publish entity.updated; writePage skips touch when fields is empty.
          await writer.writePage(tx, locked, next, locked.deletedAt === null ? ['noteType'] : []);
        }
      }
      await dbOf(tx).deleteFrom('kb_note_types').where('id', '=', input.id).execute();
      return { reassigned: pages.length };
    },
  };
}
