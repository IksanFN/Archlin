import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { sqlFor } from '@archlin/db/scoped';
import { buildRegistry, systemIds } from '@archlin/kernel';
import type { ReadTx } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import {
  PLATFORM_EVENTS,
  createEventPublisher,
  createLinkService,
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
import type { SavePageInput } from '../shared/inputs';
import type { SnapshotResult } from '../shared/types';
import { createKnowledgeApi } from './api';
import { createKnowledgeModule } from './module';
import type { KnowledgeDatabase } from './schema';
import { seedSystemNoteTypes } from './seed';

const NOW = new Date('2026-11-16T01:00:00.000Z');

const registry = buildRegistry([createKnowledgeModule({ ids: systemIds })], PLATFORM_EVENTS);
const clock = new FakeClock(NOW);
const ids = new SequenceIds();
const publisher = createEventPublisher({ registry, ids: systemIds, clock });
const spaces = createSpaceService({ registry, ids: systemIds, clock });
const tree = createTreeService({ registry, publisher, clock, ids: systemIds });
const tags = createTagService({ tree, ids: systemIds, clock });
const links = createLinkService({ registry, ids: systemIds, clock });
const api = createKnowledgeApi({ tree, tags, links, publisher, clock, ids });

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;
let spaceId: string;
let quickNoteTypeId: string;

const scopeA = () => issueOwnerScope(ownerA);
const write = <T>(fn: Parameters<typeof uow.write<T>>[1]) => uow.write(scopeA(), fn);
const read = <T>(fn: (tx: ReadTx) => Promise<T>) => uow.read(scopeA(), fn);

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations, knowledgeMigrations] }));
  db = createDatabase({ connectionString: urls.app, applicationName: 'version-service-test', max: 4 });
  uow = createOwnerUnitOfWork(db);
  for (const owner of [ownerA, ownerB]) {
    await uow.write(issueOwnerScope(owner), (tx) =>
      seedSystemNoteTypes(sqlFor<KnowledgeDatabase>(tx), owner, systemIds, NOW),
    );
  }
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  clock.set(NOW);
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    await client.query('DELETE FROM public.entities');
    await client.query('DELETE FROM public.spaces');
  } finally {
    await client.end();
  }
  spaceId = (await write((tx) => spaces.create(tx, { name: 'Basis', icon: null }))).id;
  quickNoteTypeId = await noteTypeIdByKey('quick_note');
});

async function noteTypeIdByKey(key: string): Promise<string> {
  return read(async (tx) => {
    const row = await sqlFor<KnowledgeDatabase>(tx)
      .selectFrom('kb_note_types')
      .select('id')
      .where('key', '=', key)
      .executeTakeFirst();
    if (!row) throw new Error(`missing note type ${key}`);
    return row.id;
  });
}

interface TestPage {
  entityId: string;
}

async function createPageTitled(title: string, options: { noteTypeId?: string } = {}): Promise<TestPage> {
  const created = await write((tx) =>
    api.pages.createPage(tx, {
      spaceId,
      parentId: null,
      noteTypeId: options.noteTypeId ?? quickNoteTypeId,
      placement: 'last',
      title,
    }),
  );
  return { entityId: created.entityId };
}

function docText(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

async function save(page: TestPage, content: SavePageInput['content']) {
  const view = await read((tx) => api.pages.getPage(tx, page.entityId));
  return write((tx) =>
    api.pages.savePage(tx, {
      entityId: page.entityId,
      baseVersion: view.version,
      title: view.title,
      content,
      context: view.context,
      properties: view.properties,
    }),
  );
}

async function snapshot(page: TestPage, reason: 'leave' | 'manual', label: string | null): Promise<SnapshotResult> {
  return write((tx) => api.versions.snapshot(tx, { entityId: page.entityId, reason, label }));
}

const list = (page: TestPage, before: string | null = null) =>
  read((tx) => api.versions.list(tx, { entityId: page.entityId, before }));

const get = (page: TestPage, versionId: string) =>
  read((tx) => api.versions.get(tx, { entityId: page.entityId, versionId }));

async function createNoteType(name: string, fieldSchema: FieldDefinition[] = []) {
  return write((tx) =>
    api.noteTypes.create(tx, { name, icon: null, fieldSchema, template: emptyDocument(), defaultReviewMode: 'none' }),
  );
}

async function changeType(page: TestPage, noteTypeId: string) {
  const view = await read((tx) => api.pages.getPage(tx, page.entityId));
  await write((tx) => api.pages.changeNoteType(tx, { entityId: page.entityId, baseVersion: view.version, noteTypeId }));
}

const deleteNoteType = (id: string) =>
  write((tx) => api.noteTypes.remove(tx, { id, reassignTo: quickNoteTypeId }));

function createdId(result: SnapshotResult): string {
  if (result.status !== 'created') throw new Error('expected a created snapshot');
  return result.versionId;
}

describe('VersionService snapshots', () => {
  it('a save more than ten minutes after the last one snapshots the state before it', async () => {
    const page = await createPageTitled('Runbook');
    await save(page, docText('isi pertama'));
    clock.advance(11 * 60_000);
    await save(page, docText('isi kedua'));
    const { items } = await list(page);
    expect(items.map((v) => [v.reason, v.version])).toEqual([['idle', 2]]);
    const [first] = items;
    if (!first) throw new Error('expected an idle version');
    expect((await get(page, first.id)).contentText).toBe('isi pertama');
  });

  it('a save within ten minutes does not snapshot', async () => {
    const page = await createPageTitled('Runbook');
    await save(page, docText('a'));
    clock.advance(9 * 60_000);
    await save(page, docText('b'));
    expect((await list(page)).items).toEqual([]);
  });

  it('a manual snapshot stores the label and a second identical one is unchanged', async () => {
    const page = await createPageTitled('Runbook');
    const first = await snapshot(page, 'manual', 'Sebelum revisi langkah 3');
    expect(first.status).toBe('created');
    expect(await snapshot(page, 'manual', null)).toEqual({ status: 'unchanged', versionId: createdId(first) });
    expect((await list(page)).items[0]?.label).toBe('Sebelum revisi langkah 3');
  });

  it('a leave snapshot after edits is created and without edits is unchanged', async () => {
    const page = await createPageTitled('Runbook');
    await save(page, docText('baru'));
    expect((await snapshot(page, 'leave', null)).status).toBe('created');
    expect((await snapshot(page, 'leave', null)).status).toBe('unchanged');
  });

  it('a snapshot of a page in trash fails with page_in_trash', async () => {
    const page = await createPageTitled('Runbook');
    await write((tx) => tree.trash(tx, page.entityId));
    await expect(snapshot(page, 'manual', null)).rejects.toMatchObject({ code: 'page_in_trash' });
  });

  it('a conflict copy and an overwrite are not duplicated by the idle snapshot', async () => {
    const page = await createPageTitled('Runbook');
    await save(page, docText('server'));
    clock.advance(11 * 60_000);
    const view = await read((tx) => api.pages.getPage(tx, page.entityId));
    await write((tx) =>
      api.pages.overwritePage(tx, {
        entityId: page.entityId,
        baseVersion: 1,
        seenVersion: view.version,
        title: view.title,
        content: docText('klien'),
        context: view.context,
        properties: view.properties,
      }),
    );
    expect((await list(page)).items.map((v) => v.reason)).toEqual(['conflict']);
  });
});

describe('VersionService list and get', () => {
  it('lists versions newest first with a cursor', async () => {
    const page = await createPageTitled('Runbook');
    for (let i = 0; i < 32; i += 1) {
      await save(page, docText(`isi ${i}`));
      await snapshot(page, 'leave', null);
      clock.advance(1000);
    }
    const first = await list(page);
    expect(first.items).toHaveLength(30);
    const second = await list(page, first.nextCursor);
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((v) => v.id)).size).toBe(32);
    expect(first.items[0]?.version).toBeGreaterThan(second.items[0]?.version ?? 0);
  });

  it('returns the note type name, or null when the type was deleted', async () => {
    const type = await createNoteType('Sementara');
    const page = await createPageTitled('Runbook', { noteTypeId: type.id });
    const created = await snapshot(page, 'manual', null);
    await changeType(page, quickNoteTypeId);
    await deleteNoteType(type.id);
    const detail = await get(page, createdId(created));
    expect(detail.noteType).toEqual({ id: type.id, name: null });
  });

  it('refuses a version of another page, and owner B sees nothing', async () => {
    const a = await createPageTitled('A');
    const b = await createPageTitled('B');
    const created = await snapshot(a, 'manual', null);
    const versionId = createdId(created);
    await expect(get(b, versionId)).rejects.toMatchObject({ code: 'version_not_found' });
    await expect(
      uow.read(issueOwnerScope(ownerB), (tx) => api.versions.get(tx, { entityId: a.entityId, versionId })),
    ).rejects.toMatchObject({ code: 'version_not_found' });
  });
});

const pageVersionOf = async (page: TestPage) =>
  (await read((tx) => api.pages.getPage(tx, page.entityId))).version;

const screenOf = (page: TestPage) =>
  write((tx) => api.pages.screen(tx, { entityId: page.entityId, recordView: false }));

const restore = (page: TestPage, versionId: string, baseVersion: number) =>
  write((tx) => api.versions.restore(tx, { entityId: page.entityId, versionId, baseVersion }));

async function saveProperties(page: TestPage, properties: SavePageInput['properties']) {
  const view = await read((tx) => api.pages.getPage(tx, page.entityId));
  await write((tx) =>
    api.pages.savePage(tx, {
      entityId: page.entityId,
      baseVersion: view.version,
      title: view.title,
      content: view.content,
      context: view.context,
      properties,
    }),
  );
}

async function updateFieldOptions(noteTypeId: string, key: string, options: string[]) {
  const current = await read((tx) => api.noteTypes.get(tx, noteTypeId));
  await write((tx) =>
    api.noteTypes.update(tx, {
      id: noteTypeId,
      baseRevision: current.revision,
      fieldSchema: current.fieldSchema.map((field) => (field.key === key ? { ...field, options } : field)),
    }),
  );
}

const docWith = (...nodes: SavePageInput['content'][]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: nodes }],
});
const wiki = (entityId: string | null, title: string) => ({ type: 'wikiLink', attrs: { entityId, title } });

describe('VersionService restore', () => {
  it('restoring a version writes its content as a new page version and snapshots the current state first', async () => {
    const page = await createPageTitled('Runbook');
    await save(page, docText('versi lama'));
    const old = await snapshot(page, 'manual', 'lama');
    await save(page, docText('versi baru'));
    const before = await pageVersionOf(page);
    const result = await restore(page, createdId(old), before);
    expect(result.version).toBe(before + 1);
    expect((await screenOf(page)).page.content).toEqual(docText('versi lama'));
    const reasons = (await list(page)).items.map((v) => v.reason);
    expect(reasons).toEqual(['pre_restore', 'manual']);
    expect(result.preRestoreVersionId).not.toBeNull();
    expect((await get(page, result.preRestoreVersionId ?? '')).contentText).toBe('versi baru');
  });

  it('restore with a stale base version fails with page_conflict and changes nothing', async () => {
    const page = await createPageTitled('Runbook');
    const old = await snapshot(page, 'manual', null);
    await save(page, docText('perubahan'));
    const current = await pageVersionOf(page);
    await expect(restore(page, createdId(old), current - 1)).rejects.toMatchObject({
      code: 'page_conflict',
      details: { currentVersion: current },
    });
    expect(await pageVersionOf(page)).toBe(current);
    expect((await list(page)).items.map((v) => v.reason)).toEqual(['manual']);
  });

  it('restore of a page in trash fails with page_in_trash', async () => {
    const page = await createPageTitled('Runbook');
    const old = await snapshot(page, 'manual', null);
    const current = await pageVersionOf(page);
    await write((tx) => tree.trash(tx, page.entityId));
    await expect(restore(page, createdId(old), current)).rejects.toMatchObject({ code: 'page_in_trash' });
  });

  it('restore keeps a legacy property value and returns to the version type when it still exists', async () => {
    const runbookTypeId = await noteTypeIdByKey('runbook');
    const page = await createPageTitled('Runbook', { noteTypeId: runbookTypeId });
    await saveProperties(page, { risk: 'sedang' });
    const old = await snapshot(page, 'manual', null);
    await changeType(page, quickNoteTypeId);
    await updateFieldOptions(runbookTypeId, 'risk', ['rendah', 'tinggi']);
    await restore(page, createdId(old), await pageVersionOf(page));
    const view = (await screenOf(page)).page;
    expect(view.noteType.id).toBe(runbookTypeId);
    expect(view.properties).toMatchObject({ risk: 'sedang' });
  });

  it('restore keeps the current note type when the version type was deleted', async () => {
    const temp = await createNoteType('Sementara', [{ key: 'pihak', label: 'Pihak', type: 'text' }]);
    const page = await createPageTitled('Kontrak', { noteTypeId: temp.id });
    await saveProperties(page, { pihak: 'PT Sinar Data' });
    const old = await snapshot(page, 'manual', null);
    await changeType(page, quickNoteTypeId);
    await deleteNoteType(temp.id);
    await restore(page, createdId(old), await pageVersionOf(page));
    const view = (await screenOf(page)).page;
    expect(view.noteType.id).toBe(quickNoteTypeId);
    // Not a field of the current type, so it is kept hidden rather than shown (spec 10.2).
    expect(view.properties).toMatchObject({ pihak: 'PT Sinar Data' });
  });

  it('restore of a version from another page fails with version_not_found', async () => {
    const a = await createPageTitled('A');
    const b = await createPageTitled('B');
    const old = await snapshot(a, 'manual', null);
    await expect(restore(b, createdId(old), await pageVersionOf(b))).rejects.toMatchObject({
      code: 'version_not_found',
    });
  });

  it('restore re-syncs links from the restored content', async () => {
    const target = await createPageTitled('Deploy');
    const page = await createPageTitled('Indeks');
    await save(page, docWith(wiki(target.entityId, 'Deploy')));
    const old = await snapshot(page, 'manual', null);
    await save(page, docText('tanpa link'));
    await restore(page, createdId(old), await pageVersionOf(page));
    expect((await screenOf(page)).linkTargets.map((l) => l.target?.id)).toEqual([target.entityId]);
  });

  it('restore adds no pre_restore snapshot when the current state is already the latest snapshot', async () => {
    const page = await createPageTitled('Runbook');
    const old = await snapshot(page, 'manual', null);
    await save(page, docText('b'));
    await snapshot(page, 'manual', null);
    const result = await restore(page, createdId(old), await pageVersionOf(page));
    expect(result.preRestoreVersionId).toBeNull();
    expect((await list(page)).items.map((v) => v.reason)).toEqual(['manual', 'manual']);
  });

  it('restoring the same version again snapshots the state it replaced, which differs from the latest snapshot', async () => {
    const page = await createPageTitled('Runbook');
    const old = await snapshot(page, 'manual', null);
    await save(page, docText('b'));
    await restore(page, createdId(old), await pageVersionOf(page));
    const second = await restore(page, createdId(old), await pageVersionOf(page));
    const replaced = await get(page, second.preRestoreVersionId ?? '');
    expect(replaced.reason).toBe('pre_restore');
    expect(replaced.contentText).toBe((await get(page, createdId(old))).contentText);
  });
});
