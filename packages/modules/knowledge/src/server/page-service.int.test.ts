import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { sqlFor } from '@archlin/db/scoped';
import { buildRegistry, systemIds } from '@archlin/kernel';
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
import type { SavePageInput } from '../shared/inputs';
import { createKnowledgeApi } from './api';
import { createKnowledgeModule } from './module';
import type { KnowledgeDatabase } from './schema';
import { seedSystemNoteTypes } from './seed';
import { SYSTEM_NOTE_TYPES } from './system-note-types';

const NOW = new Date('2026-11-12T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY_CONTEXT = { summary: null, whenToUse: null, source: null, aliases: [] as string[] };

const registry = buildRegistry([createKnowledgeModule({ ids: systemIds })], PLATFORM_EVENTS);
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
  db = createDatabase({ connectionString: urls.app, applicationName: 'page-service-test', max: 4 });
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
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    await client.query('DELETE FROM public.entities');
    await client.query('DELETE FROM public.spaces');
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

async function createPage(spaceId: string, noteTypeKey = 'runbook', parentId: string | null = null) {
  const noteType = await noteTypeId(noteTypeKey);
  return uow.write(scopeA(), (tx) =>
    api.pages.createPage(tx, { spaceId, parentId, noteTypeId: noteType, placement: 'last' }),
  );
}

function paragraph(text: string) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
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

describe('PageService', () => {
  it('creates a runbook page from its template at version 1', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    expect(created.spaceSlug).toBe(space.slug);

    const page = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    const runbook = SYSTEM_NOTE_TYPES.find((type) => type.key === 'runbook');
    expect(runbook).toBeDefined();
    expect(page).toMatchObject({
      entityId: created.entityId,
      spaceId: space.id,
      spaceSlug: space.slug,
      title: '',
      version: 1,
      properties: {},
      context: EMPTY_CONTEXT,
      missingRequired: [],
      legacyKeys: [],
      tags: [],
      deletedAt: null,
      trashRootId: null,
      showContextNudge: false,
    });
    expect(page.noteType).toMatchObject({ key: 'runbook', name: 'Runbook', schemaVersion: 1 });
    expect(page.content).toEqual(runbook?.template);
  });

  it('creates pages nested five levels deep', async () => {
    const space = await makeSpace();
    const chain: string[] = [];
    let parentId: string | null = null;
    await uow.write(scopeA(), async (tx) => {
      const noteType = await kb()(tx)
        .selectFrom('kb_note_types')
        .select('id')
        .where('key', '=', 'quick_note')
        .executeTakeFirst();
      if (!noteType) throw new Error('missing quick_note');
      for (let level = 1; level <= 5; level += 1) {
        const created = await api.pages.createPage(tx, {
          spaceId: space.id,
          parentId,
          noteTypeId: noteType.id,
          placement: 'last',
        });
        chain.push(created.entityId);
        parentId = created.entityId;
      }
    });
    expect(chain).toHaveLength(5);

    const roots = await uow.read(scopeA(), (tx) => tree.children(tx, { spaceId: space.id, parentId: null }));
    expect(roots.map((node) => node.id)).toEqual([chain[0]]);
    for (let i = 0; i < 4; i += 1) {
      const parent = chain[i];
      const child = chain[i + 1];
      if (parent === undefined || child === undefined) throw new Error('missing chain node');
      const kids = await uow.read(scopeA(), (tx) => tree.children(tx, { spaceId: space.id, parentId: parent }));
      expect(kids.map((node) => node.id)).toEqual([child]);
    }
  });

  it('save bumps the version and derives plain text on the server', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Tujuan' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'isi' }] },
      ],
    };
    const saved = await uow.write(scopeA(), (tx) =>
      api.pages.savePage(tx, {
        entityId: created.entityId,
        baseVersion: 1,
        title: 'Rollback Postgres 16',
        content,
        context: EMPTY_CONTEXT,
        properties: {},
      }),
    );
    expect(saved).toMatchObject({ status: 'saved', version: 2 });

    const text = await uow.read(scopeA(), async (tx) => {
      const row = await kb()(tx)
        .selectFrom('kb_pages')
        .select('content_text')
        .where('entity_id', '=', created.entityId)
        .executeTakeFirst();
      return row?.content_text;
    });
    expect(text).toBe('Tujuan\nisi');

    const page = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    expect(page).toMatchObject({ version: 2, title: 'Rollback Postgres 16' });
  });

  it('save with a stale base version is rejected with page_conflict and currentVersion', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    await uow.write(scopeA(), (tx) =>
      api.pages.savePage(tx, {
        entityId: created.entityId,
        baseVersion: 1,
        title: 'Pertama',
        content: paragraph('satu'),
        context: EMPTY_CONTEXT,
        properties: {},
      }),
    );
    await expect(
      uow.write(scopeA(), (tx) =>
        api.pages.savePage(tx, {
          entityId: created.entityId,
          baseVersion: 1,
          title: 'Kedua',
          content: paragraph('dua'),
          context: EMPTY_CONTEXT,
          properties: {},
        }),
      ),
    ).rejects.toMatchObject({ code: 'page_conflict', details: { currentVersion: 2 } });
  });

  it('retrying a committed save with the old base version returns unchanged', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    const page = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    const save = (input: Pick<SavePageInput, 'baseVersion' | 'title'>) =>
      uow.write(scopeA(), (tx) =>
        api.pages.savePage(tx, {
          entityId: created.entityId,
          content: page.content,
          context: page.context,
          properties: {},
          ...input,
        }),
      );

    const first = await save({ baseVersion: 1, title: 'Rollback Postgres 16' });
    expect(first).toMatchObject({ status: 'saved', version: 2 });
    await expect(save({ baseVersion: 1, title: 'Rollback Postgres 16' })).resolves.toMatchObject({
      status: 'unchanged',
      version: 2,
    });
  });

  it('parallel saves from the same base version: one saves, the other conflicts', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    const results = await Promise.allSettled([
      uow.write(scopeA(), (tx) =>
        api.pages.savePage(tx, {
          entityId: created.entityId,
          baseVersion: 1,
          title: 'A',
          content: paragraph('a'),
          context: EMPTY_CONTEXT,
          properties: {},
        }),
      ),
      uow.write(scopeA(), (tx) =>
        api.pages.savePage(tx, {
          entityId: created.entityId,
          baseVersion: 1,
          title: 'B',
          content: paragraph('b'),
          context: EMPTY_CONTEXT,
          properties: {},
        }),
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason).toMatchObject({
      code: 'page_conflict',
      details: { currentVersion: 2 },
    });
  });

  it('saving a page that is in trash is rejected with page_in_trash', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    await uow.write(scopeA(), (tx) => tree.trash(tx, created.entityId));
    await expect(
      uow.write(scopeA(), (tx) =>
        api.pages.savePage(tx, {
          entityId: created.entityId,
          baseVersion: 1,
          title: 'Sampah',
          content: paragraph('x'),
          context: EMPTY_CONTEXT,
          properties: {},
        }),
      ),
    ).rejects.toMatchObject({ code: 'page_in_trash' });
  });

  it('save rejects a select value outside the options', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    const page = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    await expect(
      uow.write(scopeA(), (tx) =>
        api.pages.savePage(tx, {
          entityId: created.entityId,
          baseVersion: 1,
          title: page.title,
          content: page.content,
          context: page.context,
          properties: { risk: 'kritis' },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      details: { issues: [{ path: 'properties.risk', message: 'invalid_property' }] },
    });
  });

  it('save keeps a legacy property value untouched', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    await uow.write(scopeA(), async (tx) => {
      await kb()(tx)
        .updateTable('kb_pages')
        .set({ properties: JSON.stringify({ risk: 'kritis' }) })
        .where('entity_id', '=', created.entityId)
        .execute();
    });
    const page = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    const saved = await uow.write(scopeA(), (tx) =>
      api.pages.savePage(tx, {
        entityId: created.entityId,
        baseVersion: 1,
        title: 'Legacy',
        content: page.content,
        context: page.context,
        properties: { risk: 'kritis' },
      }),
    );
    expect(saved).toMatchObject({ status: 'saved', version: 2 });
    const after = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    expect(after.properties).toEqual({ risk: 'kritis' });
    expect(after.legacyKeys).toEqual(['risk']);
  });

  it('save rejects a javascript link with unsafe_url', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    await expect(
      uow.write(scopeA(), (tx) =>
        api.pages.savePage(tx, {
          entityId: created.entityId,
          baseVersion: 1,
          title: 'Tautan',
          content: javascriptLink,
          context: EMPTY_CONTEXT,
          properties: {},
        }),
      ),
    ).rejects.toMatchObject({
      code: 'unsafe_url',
      details: { issues: [{ path: 'content', message: 'unsafe_url' }] },
    });
  });

  it('rename from the tree bumps the version so a stale editor save conflicts', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    const renamed = await uow.write(scopeA(), (tx) =>
      api.pages.renamePage(tx, { entityId: created.entityId, title: 'Dari pohon' }),
    );
    expect(renamed).toEqual({ version: 2 });

    const page = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    expect(page).toMatchObject({ title: 'Dari pohon', version: 2 });

    await expect(
      uow.write(scopeA(), (tx) =>
        api.pages.savePage(tx, {
          entityId: created.entityId,
          baseVersion: 1,
          title: 'Editor',
          content: page.content,
          context: page.context,
          properties: {},
        }),
      ),
    ).rejects.toMatchObject({ code: 'page_conflict', details: { currentVersion: 2 } });
  });

  it('overwrite stores the server copy as a conflict version, then writes', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    await uow.write(scopeA(), (tx) =>
      api.pages.savePage(tx, {
        entityId: created.entityId,
        baseVersion: 1,
        title: 'Salinan server',
        content: paragraph('server'),
        context: EMPTY_CONTEXT,
        properties: {},
      }),
    );

    const overwritten = await uow.write(scopeA(), (tx) =>
      api.pages.overwritePage(tx, {
        entityId: created.entityId,
        baseVersion: 1,
        seenVersion: 2,
        title: 'Salinan klien',
        content: paragraph('klien'),
        context: EMPTY_CONTEXT,
        properties: {},
      }),
    );
    expect(overwritten).toMatchObject({ status: 'saved', version: 3 });

    const page = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    expect(page).toMatchObject({ title: 'Salinan klien', version: 3 });

    const versions = await uow.read(scopeA(), (tx) =>
      kb()(tx)
        .selectFrom('kb_page_versions')
        .select(['version', 'title', 'reason', 'content_text'])
        .where('entity_id', '=', created.entityId)
        .execute(),
    );
    expect(versions).toEqual([
      expect.objectContaining({ version: 2, title: 'Salinan server', reason: 'conflict', content_text: 'server' }),
    ]);
  });

  it('overwrite after a third change is rejected again', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    await uow.write(scopeA(), (tx) =>
      api.pages.savePage(tx, {
        entityId: created.entityId,
        baseVersion: 1,
        title: 'Satu',
        content: paragraph('satu'),
        context: EMPTY_CONTEXT,
        properties: {},
      }),
    );
    await uow.write(scopeA(), (tx) =>
      api.pages.savePage(tx, {
        entityId: created.entityId,
        baseVersion: 2,
        title: 'Dua',
        content: paragraph('dua'),
        context: EMPTY_CONTEXT,
        properties: {},
      }),
    );
    await expect(
      uow.write(scopeA(), (tx) =>
        api.pages.overwritePage(tx, {
          entityId: created.entityId,
          baseVersion: 2,
          seenVersion: 2,
          title: 'Tiga',
          content: paragraph('tiga'),
          context: EMPTY_CONTEXT,
          properties: {},
        }),
      ),
    ).rejects.toMatchObject({ code: 'page_conflict', details: { currentVersion: 3 } });
  });

  it('a conflict copy is stored even when the page is in trash', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    const page = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    await uow.write(scopeA(), (tx) => tree.trash(tx, created.entityId));

    const copy = await uow.write(scopeA(), (tx) =>
      api.pages.saveConflictCopy(tx, {
        entityId: created.entityId,
        baseVersion: 1,
        title: 'Draf konflik',
        content: paragraph('konflik'),
        context: EMPTY_CONTEXT,
        properties: {},
      }),
    );
    expect(copy.versionId).toEqual(expect.any(String));

    const versions = await uow.read(scopeA(), (tx) =>
      kb()(tx)
        .selectFrom('kb_page_versions')
        .select(['id', 'version', 'title', 'reason'])
        .where('entity_id', '=', created.entityId)
        .execute(),
    );
    expect(versions).toEqual([
      expect.objectContaining({
        id: copy.versionId,
        version: 1,
        title: 'Draf konflik',
        reason: 'conflict',
      }),
    ]);
    expect(page.version).toBe(1);
  });

  it('change note type keeps properties of keys the new type lacks', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    const page = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    await uow.write(scopeA(), (tx) =>
      api.pages.savePage(tx, {
        entityId: created.entityId,
        baseVersion: 1,
        title: 'Runbook lama',
        content: page.content,
        context: page.context,
        properties: { system: 'postgres', risk: 'tinggi' },
      }),
    );
    const quickNote = await noteTypeId('quick_note');
    const changed = await uow.write(scopeA(), (tx) =>
      api.pages.changeNoteType(tx, {
        entityId: created.entityId,
        baseVersion: 2,
        noteTypeId: quickNote,
      }),
    );
    expect(changed.noteType.key).toBe('quick_note');
    expect(changed.version).toBe(3);
    expect(changed.properties).toEqual({ system: 'postgres', risk: 'tinggi' });
    expect(changed.content).toEqual(page.content);
  });

  it('getPage shows the context nudge only after a day without summary and when-to-use', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id, 'quick_note');
    const fresh = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    expect(fresh.showContextNudge).toBe(false);

    clock.advance(DAY_MS);
    const atDay = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    expect(atDay.showContextNudge).toBe(false);

    clock.advance(1);
    const overdue = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    expect(overdue.showContextNudge).toBe(true);

    await uow.write(scopeA(), (tx) =>
      api.pages.savePage(tx, {
        entityId: created.entityId,
        baseVersion: 1,
        title: overdue.title,
        content: overdue.content,
        context: { ...EMPTY_CONTEXT, summary: 'Ringkasan' },
        properties: {},
      }),
    );
    const filled = await uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId));
    expect(filled.showContextNudge).toBe(false);
  });

  it('owner B gets page_not_found for a page of owner A', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    await expect(uow.read(scopeB(), (tx) => api.pages.getPage(tx, created.entityId))).rejects.toMatchObject({
      code: 'page_not_found',
    });
  });

  it('purging the entity removes the page and its versions', async () => {
    const space = await makeSpace();
    const created = await createPage(space.id);
    await uow.write(scopeA(), (tx) =>
      api.pages.saveConflictCopy(tx, {
        entityId: created.entityId,
        baseVersion: 1,
        title: 'Cadangan',
        content: paragraph('cadangan'),
        context: EMPTY_CONTEXT,
        properties: {},
      }),
    );
    await uow.write(scopeA(), (tx) => tree.trash(tx, created.entityId));
    await uow.write(scopeA(), (tx) => tree.purge(tx, created.entityId));

    await expect(uow.read(scopeA(), (tx) => api.pages.getPage(tx, created.entityId))).rejects.toMatchObject({
      code: 'page_not_found',
    });

    const leftover = await uow.read(scopeA(), async (tx) => {
      const pages = await kb()(tx)
        .selectFrom('kb_pages')
        .select('entity_id')
        .where('entity_id', '=', created.entityId)
        .execute();
      const versions = await kb()(tx)
        .selectFrom('kb_page_versions')
        .select('id')
        .where('entity_id', '=', created.entityId)
        .execute();
      return { pages, versions };
    });
    expect(leftover).toEqual({ pages: [], versions: [] });
  });
});
