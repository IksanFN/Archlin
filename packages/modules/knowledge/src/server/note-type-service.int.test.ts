import { randomUUID } from 'node:crypto';
import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { sqlFor } from '@archlin/db/scoped';
import { buildRegistry, defineHandler, defineModule, systemIds } from '@archlin/kernel';
import type { EventEnvelope } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import {
  PLATFORM_EVENTS,
  createEventPublisher,
  createSpaceService,
  createTagService,
  createTreeService,
} from '@archlin/platform/server';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { FakeClock, SequenceIds } from '@archlin/testing/fakes';
import { fixtureMigrations } from '@archlin/testing/fixture-module';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { knowledgeMigrations } from '../migrations';
import { emptyDocument } from '../shared/document-schema';
import type { FieldDefinition } from '../shared/field-schema';
import { createKnowledgeApi } from './api';
import { createKnowledgeModule, noteTypeUpdated } from './module';
import type { KnowledgeDatabase } from './schema';
import { seedSystemNoteTypes } from './seed';
import { SYSTEM_NOTE_TYPES } from './system-note-types';

const NOW = new Date('2026-11-12T00:00:00.000Z');

const captured: EventEnvelope<{ fieldsChanged: boolean }>[] = [];
const probe = defineModule({
  id: 'probe',
  eventHandlers: [
    defineHandler({
      id: 'onNoteTypeUpdated',
      event: noteTypeUpdated,
      mode: 'sync',
      handle: async (event) => {
        captured.push(event);
      },
    }),
  ],
});
const registry = buildRegistry([createKnowledgeModule({ ids: systemIds }), probe], PLATFORM_EVENTS);
const clock = new FakeClock(NOW);
const ids = new SequenceIds();
const publisher = createEventPublisher({ registry, ids: systemIds, clock });
const spaces = createSpaceService({ registry, ids: systemIds, clock });
const tree = createTreeService({ registry, publisher, clock, ids: systemIds });
const tags = createTagService({ tree, ids: systemIds, clock });
const api = createKnowledgeApi({ tree, tags, publisher, clock, ids });

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations, knowledgeMigrations] }));
  db = createDatabase({ connectionString: urls.app, applicationName: 'note-type-service-test', max: 4 });
  uow = createOwnerUnitOfWork(db);
  await uow.write(issueOwnerScope(ownerA), (tx) =>
    seedSystemNoteTypes(sqlFor<KnowledgeDatabase>(tx), ownerA, systemIds, NOW),
  );
  await uow.write(issueOwnerScope(ownerB), (tx) =>
    seedSystemNoteTypes(sqlFor<KnowledgeDatabase>(tx), ownerB, systemIds, NOW),
  );
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  clock.set(NOW);
  captured.length = 0;
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    await client.query('DELETE FROM public.entities');
    await client.query('DELETE FROM public.spaces');
    await client.query('DELETE FROM public.kb_note_types WHERE is_system = false');
  } finally {
    await client.end();
  }
});

const scopeA = () => issueOwnerScope(ownerA);
const scopeB = () => issueOwnerScope(ownerB);

const kb = () => sqlFor<KnowledgeDatabase>;

async function makeSpace() {
  return uow.write(scopeA(), (tx) => spaces.create(tx, { name: 'Basis', icon: null }));
}

async function noteTypeId(key: string, scope = scopeA()) {
  return uow.read(scope, async (tx) => {
    const row = await kb()(tx)
      .selectFrom('kb_note_types')
      .select('id')
      .where('key', '=', key)
      .executeTakeFirst();
    if (!row) throw new Error(`missing note type ${key}`);
    return row.id;
  });
}

function createCustom(name: string, fieldSchema: FieldDefinition[] = []) {
  return uow.write(scopeA(), (tx) =>
    api.noteTypes.create(tx, {
      name,
      icon: null,
      fieldSchema,
      template: emptyDocument(),
      defaultReviewMode: 'none',
    }),
  );
}

function createPage(spaceId: string, noteTypeId: string) {
  return uow.write(scopeA(), (tx) =>
    api.pages.createPage(tx, { spaceId, parentId: null, noteTypeId, placement: 'last' }),
  );
}

async function pageHash(entityId: string) {
  return uow.read(scopeA(), async (tx) => {
    const row = await kb()(tx)
      .selectFrom('kb_pages')
      .select('content_hash')
      .where('entity_id', '=', entityId)
      .executeTakeFirst();
    return row?.content_hash;
  });
}

const javascriptLink = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'x',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
        },
      ],
    },
  ],
};

describe('NoteTypeService', () => {
  it('lists the five system types in order with page counts', async () => {
    const space = await makeSpace();
    const runbook = await noteTypeId('runbook');
    const quickNote = await noteTypeId('quick_note');
    const livingRunbook = await createPage(space.id, runbook);
    await createPage(space.id, runbook);
    await createPage(space.id, quickNote);
    await uow.write(scopeA(), (tx) => tree.trash(tx, livingRunbook.entityId));

    const listed = await uow.read(scopeA(), (tx) => api.noteTypes.list(tx));
    expect(listed.map((type) => type.key)).toEqual(SYSTEM_NOTE_TYPES.map((type) => type.key));
    expect(listed.map((type) => type.pageCount)).toEqual([1, 0, 0, 1, 0]);
    expect(listed.every((type) => type.isSystem)).toBe(true);
    expect(listed.map((type) => type.defaultReviewMode)).toEqual(
      SYSTEM_NOTE_TYPES.map((type) => type.defaultReviewMode),
    );
  });

  it('create derives a unique key from the name', async () => {
    const meeting = await createCustom('Catatan Rapat');
    expect(meeting).toMatchObject({
      key: 'catatan_rapat',
      name: 'Catatan Rapat',
      isSystem: false,
      schemaVersion: 1,
      pageCount: 0,
      defaultReviewMode: 'none',
    });
    expect(meeting.template).toEqual(emptyDocument());

    const duplicate = await createCustom('Catatan Rapat');
    expect(duplicate.key).toBe('catatan_rapat_2');

    const runbook = await createCustom('Runbook');
    expect(runbook.key).toBe('runbook_2');
  });

  it('update bumps schemaVersion only when fields change and publishes kb.noteType.updated', async () => {
    const created = await createCustom('Kustom');
    const renamed = await uow.write(scopeA(), (tx) =>
      api.noteTypes.update(tx, { id: created.id, baseRevision: 1, name: 'Nama baru' }),
    );
    expect(renamed).toMatchObject({ name: 'Nama baru', schemaVersion: 1, revision: 2 });

    const withFields = await uow.write(scopeA(), (tx) =>
      api.noteTypes.update(tx, {
        id: created.id,
        baseRevision: 2,
        fieldSchema: [{ key: 'system', label: 'Sistem', type: 'text' }],
      }),
    );
    expect(withFields).toMatchObject({ schemaVersion: 2, revision: 3 });
    expect(withFields.fieldSchema).toEqual([{ key: 'system', label: 'Sistem', type: 'text' }]);

    expect(captured).toEqual([
      expect.objectContaining({
        type: 'kb.noteType.updated',
        aggregateId: created.id,
        aggregateRevision: 2,
        payload: { fieldsChanged: false },
      }),
      expect.objectContaining({
        type: 'kb.noteType.updated',
        aggregateId: created.id,
        aggregateRevision: 3,
        payload: { fieldsChanged: true },
      }),
    ]);
  });

  it('changing the type of an existing field is rejected', async () => {
    const created = await createCustom('Kustom', [{ key: 'system', label: 'Sistem', type: 'text' }]);
    await expect(
      uow.write(scopeA(), (tx) =>
        api.noteTypes.update(tx, {
          id: created.id,
          baseRevision: 1,
          fieldSchema: [{ key: 'system', label: 'Sistem', type: 'longtext' }],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      details: { issues: [{ path: 'fieldSchema.0.type', message: 'field_type_immutable' }] },
    });
  });

  it('a stale revision is rejected with note_type_conflict', async () => {
    const created = await createCustom('Kustom');
    await uow.write(scopeA(), (tx) =>
      api.noteTypes.update(tx, {
        id: created.id,
        baseRevision: 1,
        fieldSchema: [{ key: 'system', label: 'Sistem', type: 'text' }],
      }),
    );
    await expect(
      uow.write(scopeA(), (tx) => api.noteTypes.update(tx, { id: created.id, baseRevision: 1, name: 'Stale' })),
    ).rejects.toMatchObject({
      code: 'note_type_conflict',
      details: { currentRevision: 2 },
    });
  });

  it('update with a stale revision is rejected even when only the name changed', async () => {
    const created = await createCustom('Resep');
    expect(created.revision).toBe(1);
    const renamed = await uow.write(scopeA(), (tx) =>
      api.noteTypes.update(tx, { id: created.id, baseRevision: created.revision, name: 'Resep A' }),
    );
    expect(renamed).toMatchObject({ revision: 2, schemaVersion: 1 });
    await expect(
      uow.write(scopeA(), (tx) =>
        api.noteTypes.update(tx, { id: created.id, baseRevision: 1, template: emptyDocument() }),
      ),
    ).rejects.toMatchObject({ code: 'note_type_conflict', details: { currentRevision: 2 } });
  });

  it('a type used only by pages in trash reports them and needs a reassign target', async () => {
    const custom = await createCustom('Kustom');
    const quickNote = await noteTypeId('quick_note');
    const space = await makeSpace();
    const page = await createPage(space.id, custom.id);
    await uow.write(scopeA(), (tx) => tree.trash(tx, page.entityId));

    const listed = await uow.read(scopeA(), (tx) => api.noteTypes.list(tx));
    expect(listed.find((type) => type.id === custom.id)).toMatchObject({ pageCount: 0, trashedPageCount: 1 });
    await expect(
      uow.write(scopeA(), (tx) => api.noteTypes.remove(tx, { id: custom.id, reassignTo: null })),
    ).rejects.toMatchObject({ code: 'note_type_in_use', details: { pageCount: 0, trashedPageCount: 1 } });
    await expect(
      uow.write(scopeA(), (tx) => api.noteTypes.remove(tx, { id: custom.id, reassignTo: quickNote })),
    ).resolves.toEqual({ reassigned: 1 });
  });

  it('reorder with an unknown sibling is rejected with invalid_sibling', async () => {
    const custom = await createCustom('Kustom');
    await expect(
      uow.write(scopeA(), (tx) => api.noteTypes.reorder(tx, { id: custom.id, beforeId: randomUUID(), afterId: null })),
    ).rejects.toMatchObject({ code: 'invalid_sibling' });
  });

  it('a system type cannot be deleted', async () => {
    const runbook = await noteTypeId('runbook');
    await expect(
      uow.write(scopeA(), (tx) => api.noteTypes.remove(tx, { id: runbook, reassignTo: null })),
    ).rejects.toMatchObject({ code: 'system_type_locked' });
  });

  it('deleting a used type without a target reports the page count', async () => {
    const custom = await createCustom('Kustom');
    const space = await makeSpace();
    const living = await createPage(space.id, custom.id);
    await createPage(space.id, custom.id);
    await uow.write(scopeA(), (tx) => tree.trash(tx, living.entityId));

    await expect(
      uow.write(scopeA(), (tx) => api.noteTypes.remove(tx, { id: custom.id, reassignTo: null })),
    ).rejects.toMatchObject({
      code: 'note_type_in_use',
      details: { pageCount: 1, trashedPageCount: 1 },
    });
  });

  it('deleting with a target moves pages, bumps their versions and removes the type', async () => {
    const custom = await createCustom('Kustom');
    const quickNote = await noteTypeId('quick_note');
    const space = await makeSpace();
    const living = await createPage(space.id, custom.id);
    const trashed = await createPage(space.id, custom.id);
    await uow.write(scopeA(), (tx) => tree.trash(tx, trashed.entityId));

    const beforeLiving = await uow.read(scopeA(), (tx) => tree.get(tx, living.entityId));
    const beforeTrashed = await uow.read(scopeA(), (tx) => tree.get(tx, trashed.entityId));
    const livingHash = await pageHash(living.entityId);
    const trashedHash = await pageHash(trashed.entityId);

    const removed = await uow.write(scopeA(), (tx) =>
      api.noteTypes.remove(tx, { id: custom.id, reassignTo: quickNote }),
    );
    expect(removed).toEqual({ reassigned: 2 });

    await expect(uow.read(scopeA(), (tx) => api.noteTypes.get(tx, custom.id))).rejects.toMatchObject({
      code: 'note_type_not_found',
    });

    const livingPage = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, living.entityId));
    const trashedPage = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, trashed.entityId));
    expect(livingPage).toMatchObject({ noteType: { id: quickNote, key: 'quick_note' }, version: 2 });
    expect(trashedPage).toMatchObject({ noteType: { id: quickNote, key: 'quick_note' }, version: 2 });
    expect(await pageHash(living.entityId)).not.toBe(livingHash);
    expect(await pageHash(trashed.entityId)).not.toBe(trashedHash);

    const afterLiving = await uow.read(scopeA(), (tx) => tree.get(tx, living.entityId));
    const afterTrashed = await uow.read(scopeA(), (tx) => tree.get(tx, trashed.entityId));
    expect(afterLiving.revision).toBe(beforeLiving.revision + 1);
    expect(afterTrashed.revision).toBe(beforeTrashed.revision);
  });

  it('an unsafe template link is rejected', async () => {
    await expect(
      uow.write(scopeA(), (tx) =>
        api.noteTypes.create(tx, {
          name: 'Tautan',
          icon: null,
          fieldSchema: [],
          template: javascriptLink,
          defaultReviewMode: 'none',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'unsafe_url',
      details: { issues: [{ path: 'content', message: 'unsafe_url' }] },
    });
  });

  it('create stores the template without unknown keys', async () => {
    const created = await uow.write(scopeA(), (tx) =>
      api.noteTypes.create(tx, {
        name: 'Bersih',
        icon: null,
        fieldSchema: [],
        template: { type: 'doc', junk: true, content: [{ type: 'paragraph' }] },
        defaultReviewMode: 'none',
      }),
    );
    expect(created.template).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('create rejects a template whose root is not doc', async () => {
    await expect(
      uow.write(scopeA(), (tx) =>
        api.noteTypes.create(tx, {
          name: 'Akar salah',
          icon: null,
          fieldSchema: [],
          template: { type: 'paragraph' },
          defaultReviewMode: 'none',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_document' });
  });

  it('owner B never sees the types of owner A', async () => {
    const custom = await createCustom('Milik A');
    const listB = await uow.read(scopeB(), (tx) => api.noteTypes.list(tx));
    expect(listB.map((type) => type.id)).not.toContain(custom.id);
    expect(listB.map((type) => type.key)).toEqual(SYSTEM_NOTE_TYPES.map((type) => type.key));
    await expect(uow.read(scopeB(), (tx) => api.noteTypes.get(tx, custom.id))).rejects.toMatchObject({
      code: 'note_type_not_found',
    });
  });
});
