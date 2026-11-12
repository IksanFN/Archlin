import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { buildRegistry, defineHandler, defineModule, systemIds } from '@archlin/kernel';
import type { EventEnvelope } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { FakeClock } from '@archlin/testing/fakes';
import { fixtureMigrations, fixtureModule } from '@archlin/testing/fixture-module';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events';
import {
  entityCreated,
  entityDeleted,
  entityMoved,
  entityRestored,
  entityUpdated,
} from './events';
import { createSpaceService } from './space-service';
import { createTreeService } from './tree-service';

const KIND = 'fixture.item';
const NOW = new Date('2026-11-12T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const captured: EventEnvelope<unknown>[] = [];
const PLATFORM_EVENTS = [entityCreated, entityUpdated, entityMoved, entityDeleted, entityRestored];
const probeModule = defineModule({
  id: 'probe',
  eventHandlers: [
    defineHandler({ id: 'onCreated', event: entityCreated, mode: 'sync', handle: async (event) => { captured.push(event); } }),
    defineHandler({ id: 'onUpdated', event: entityUpdated, mode: 'sync', handle: async (event) => { captured.push(event); } }),
    defineHandler({ id: 'onMoved', event: entityMoved, mode: 'sync', handle: async (event) => { captured.push(event); } }),
    defineHandler({ id: 'onDeleted', event: entityDeleted, mode: 'sync', handle: async (event) => { captured.push(event); } }),
    defineHandler({ id: 'onRestored', event: entityRestored, mode: 'sync', handle: async (event) => { captured.push(event); } }),
  ],
});
const registry = buildRegistry([fixtureModule, probeModule], PLATFORM_EVENTS);
const clock = new FakeClock(NOW);
const publisher = createEventPublisher({ registry, ids: systemIds, clock });
const spaces = createSpaceService({ registry, ids: systemIds, clock });
const tree = createTreeService({ registry, publisher, clock, ids: systemIds });

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations] }));
  db = createDatabase({ connectionString: urls.app, applicationName: 'tree-service-test', max: 4 });
  uow = createOwnerUnitOfWork(db);
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  captured.length = 0;
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

const makeSpace = (name: string) => uow.write(scopeA(), (tx) => spaces.create(tx, { name, icon: null }));

const make = (spaceId: string, title: string, parentId: string | null = null, placement: 'first' | 'last' = 'last') =>
  uow.write(scopeA(), (tx) =>
    tree.create(tx, { kind: KIND, spaceId, parentId, title, icon: null, placement }),
  );

describe('TreeService', () => {
  it('creates a chain six levels deep and lists each level in order', async () => {
    const space = await makeSpace('Rantai');
    const chain = await uow.write(scopeA(), async (tx) => {
      const nodes = [];
      let parentId: string | null = null;
      for (let level = 1; level <= 6; level += 1) {
        const node = await tree.create(tx, {
          kind: KIND,
          spaceId: space.id,
          parentId,
          title: `L${level}`,
          icon: null,
          placement: 'last',
        });
        nodes.push(node);
        parentId = node.id;
      }
      return nodes;
    });
    expect(chain).toHaveLength(6);

    const roots = await uow.read(scopeA(), (tx) => tree.children(tx, { spaceId: space.id, parentId: null }));
    expect(roots.map((node) => node.id)).toEqual([chain[0]?.id]);
    expect(roots[0]).toMatchObject({ title: 'L1', hasChildren: true, isStarred: false });

    for (let i = 0; i < 5; i += 1) {
      const parent = chain[i];
      const child = chain[i + 1];
      expect(parent).toBeDefined();
      expect(child).toBeDefined();
      if (parent === undefined || child === undefined) return;
      const kids = await uow.read(scopeA(), (tx) =>
        tree.children(tx, { spaceId: space.id, parentId: parent.id }),
      );
      expect(kids.map((node) => node.id)).toEqual([child.id]);
      expect(kids[0]?.title).toBe(`L${i + 2}`);
      expect(kids[0]?.hasChildren).toBe(i < 4);
    }

    const deepest = chain[5];
    expect(deepest).toBeDefined();
    if (deepest === undefined) return;
    const crumbs = await uow.read(scopeA(), (tx) => tree.ancestors(tx, deepest.id));
    expect(crumbs.map((node) => node.id)).toEqual(chain.slice(0, 5).map((node) => node.id));
    expect(crumbs.map((node) => node.title)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);
  });

  it('create rejects level 33 with tree_too_deep', async () => {
    const space = await makeSpace('Dalam');
    const deepest = await uow.write(scopeA(), async (tx) => {
      let parentId: string | null = null;
      let last = { id: '' };
      for (let level = 1; level <= 32; level += 1) {
        last = await tree.create(tx, {
          kind: KIND,
          spaceId: space.id,
          parentId,
          title: `D${level}`,
          icon: null,
          placement: 'last',
        });
        parentId = last.id;
      }
      return last;
    });
    await expect(
      uow.write(scopeA(), (tx) =>
        tree.create(tx, {
          kind: KIND,
          spaceId: space.id,
          parentId: deepest.id,
          title: 'D33',
          icon: null,
          placement: 'last',
        }),
      ),
    ).rejects.toMatchObject({ code: 'tree_too_deep' });
  });

  it('move reorders between two siblings', async () => {
    const space = await makeSpace('Urutan');
    const a = await make(space.id, 'A');
    const b = await make(space.id, 'B');
    const c = await make(space.id, 'C');
    await uow.write(scopeA(), (tx) =>
      tree.move(tx, { entityId: c.id, targetSpaceId: space.id, newParentId: null, beforeId: null, afterId: a.id }),
    );
    const kids = await uow.read(scopeA(), (tx) => tree.children(tx, { spaceId: space.id, parentId: null }));
    expect(kids.map((node) => node.id)).toEqual([a.id, c.id, b.id]);
  });

  it('move into its own descendant is rejected with tree_cycle', async () => {
    const space = await makeSpace('Siklus');
    const parent = await make(space.id, 'P');
    const child = await make(space.id, 'C', parent.id);
    await expect(
      uow.write(scopeA(), (tx) =>
        tree.move(tx, {
          entityId: parent.id,
          targetSpaceId: space.id,
          newParentId: child.id,
          beforeId: null,
          afterId: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'tree_cycle' });
  });

  it('opposite parallel moves leave the tree acyclic', async () => {
    const space = await makeSpace('Paralel');
    const { id: x } = await make(space.id, 'X');
    const { id: y } = await make(space.id, 'Y');
    const s = space.id;
    const results = await Promise.allSettled([
      uow.write(scopeA(), (tx) => tree.move(tx, { entityId: x, targetSpaceId: s, newParentId: y, beforeId: null, afterId: null })),
      uow.write(scopeA(), (tx) => tree.move(tx, { entityId: y, targetSpaceId: s, newParentId: x, beforeId: null, afterId: null })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')?.reason).toMatchObject({ code: 'tree_cycle' });
  });

  it('move to another space carries the subtree, trashed descendants included', async () => {
    const from = await makeSpace('Asal');
    const to = await makeSpace('Tujuan');
    const parent = await make(from.id, 'P');
    const child = await make(from.id, 'C', parent.id);
    const trashed = await make(from.id, 'G', child.id);
    await uow.write(scopeA(), (tx) => tree.trash(tx, trashed.id));

    const moved = await uow.write(scopeA(), (tx) =>
      tree.move(tx, {
        entityId: parent.id,
        targetSpaceId: to.id,
        newParentId: null,
        beforeId: null,
        afterId: null,
      }),
    );
    expect(moved.spaceId).toBe(to.id);
    expect(moved.parentId).toBeNull();

    const liveChild = await uow.read(scopeA(), (tx) => tree.get(tx, child.id));
    const goneChild = await uow.read(scopeA(), (tx) => tree.get(tx, trashed.id));
    expect(liveChild.spaceId).toBe(to.id);
    expect(liveChild.parentId).toBe(parent.id);
    expect(goneChild.spaceId).toBe(to.id);
    expect(goneChild.parentId).toBe(child.id);
    expect(goneChild.deletedAt).not.toBeNull();
  });

  it('move to the root of another space', async () => {
    const from = await makeSpace('Dari');
    const to = await makeSpace('Ke');
    const page = await make(from.id, 'Halaman');
    const nested = await make(from.id, 'Anak', page.id);
    const moved = await uow.write(scopeA(), (tx) =>
      tree.move(tx, {
        entityId: page.id,
        targetSpaceId: to.id,
        newParentId: null,
        beforeId: null,
        afterId: null,
      }),
    );
    expect(moved).toMatchObject({ spaceId: to.id, parentId: null });
    const child = await uow.read(scopeA(), (tx) => tree.get(tx, nested.id));
    expect(child.spaceId).toBe(to.id);
    const destRoots = await uow.read(scopeA(), (tx) => tree.children(tx, { spaceId: to.id, parentId: null }));
    expect(destRoots.map((node) => node.id)).toEqual([page.id]);
  });

  it('move into an archived space is rejected with space_archived', async () => {
    const from = await makeSpace('Hidup');
    const archived = await makeSpace('Arsip');
    await uow.write(scopeA(), (tx) => spaces.archive(tx, archived.id));
    const page = await make(from.id, 'Pindah');
    await expect(
      uow.write(scopeA(), (tx) =>
        tree.move(tx, {
          entityId: page.id,
          targetSpaceId: archived.id,
          newParentId: null,
          beforeId: null,
          afterId: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'space_archived' });
  });

  it('trash keeps an earlier trash root intact', async () => {
    const space = await makeSpace('Sampah');
    const parent = await make(space.id, 'P');
    const child = await make(space.id, 'C', parent.id);
    await uow.write(scopeA(), (tx) => tree.trash(tx, child.id));
    await uow.write(scopeA(), (tx) => tree.trash(tx, parent.id));

    await uow.write(scopeA(), (tx) => tree.restore(tx, parent.id));
    const stillTrashed = await uow.read(scopeA(), (tx) => tree.get(tx, child.id));
    expect(stillTrashed.deletedAt).not.toBeNull();

    const restored = await uow.write(scopeA(), (tx) => tree.restore(tx, child.id));
    expect(restored).toMatchObject({ entityId: child.id, parentId: parent.id, restoredToRoot: false, count: 1 });
    const back = await uow.read(scopeA(), (tx) => tree.get(tx, child.id));
    expect(back.deletedAt).toBeNull();
    expect(back.parentId).toBe(parent.id);
  });

  it('restore goes to the space root when the parent is still in trash', async () => {
    const space = await makeSpace('IndukSampah');
    const parent = await make(space.id, 'P');
    const child = await make(space.id, 'C', parent.id);
    await uow.write(scopeA(), (tx) => tree.trash(tx, child.id));
    await uow.write(scopeA(), (tx) => tree.trash(tx, parent.id));

    const outcome = await uow.write(scopeA(), (tx) => tree.restore(tx, child.id));
    expect(outcome).toMatchObject({
      entityId: child.id,
      parentId: null,
      restoredToRoot: true,
      spaceSlug: space.slug,
      count: 1,
    });
    const restored = await uow.read(scopeA(), (tx) => tree.get(tx, child.id));
    expect(restored.parentId).toBeNull();
    expect(restored.deletedAt).toBeNull();
  });

  it('restore moves to the end when the old position is taken', async () => {
    const space = await makeSpace('Posisi');
    const first = await make(space.id, 'Pertama');
    await uow.write(scopeA(), (tx) => tree.trash(tx, first.id));
    const taken = await make(space.id, 'Pengganti');
    await uow.write(scopeA(), (tx) => tree.restore(tx, first.id));
    const kids = await uow.read(scopeA(), (tx) => tree.children(tx, { spaceId: space.id, parentId: null }));
    expect(kids.map((node) => node.id)).toEqual([taken.id, first.id]);
  });

  it('restore into an archived space reports spaceArchived', async () => {
    const space = await makeSpace('Arsipkan');
    const page = await make(space.id, 'Halaman');
    await uow.write(scopeA(), (tx) => tree.trash(tx, page.id));
    await uow.write(scopeA(), (tx) => spaces.archive(tx, space.id));
    const outcome = await uow.write(scopeA(), (tx) => tree.restore(tx, page.id));
    expect(outcome).toMatchObject({
      entityId: page.id,
      spaceArchived: true,
      restoredToRoot: true,
      count: 1,
    });
    const restored = await uow.read(scopeA(), (tx) => tree.get(tx, page.id));
    expect(restored.deletedAt).toBeNull();
  });

  it('purge removes the whole operation and releases a separately trashed child to the space root', async () => {
    const space = await makeSpace('Purge');
    const parent = await make(space.id, 'P');
    const kept = await make(space.id, 'C', parent.id);
    const withParent = await make(space.id, 'D', parent.id);
    await uow.write(scopeA(), (tx) => tree.trash(tx, kept.id));
    await uow.write(scopeA(), (tx) => tree.trash(tx, parent.id));

    const result = await uow.write(scopeA(), (tx) => tree.purge(tx, parent.id));
    expect(result.count).toBe(2);
    await expect(uow.read(scopeA(), (tx) => tree.get(tx, parent.id))).rejects.toMatchObject({
      code: 'entity_not_found',
    });
    await expect(uow.read(scopeA(), (tx) => tree.get(tx, withParent.id))).rejects.toMatchObject({
      code: 'entity_not_found',
    });
    const released = await uow.read(scopeA(), (tx) => tree.get(tx, kept.id));
    expect(released.parentId).toBeNull();
    expect(released.deletedAt).not.toBeNull();
  });

  it('purgeExpired removes only roots older than 30 days', async () => {
    const space = await makeSpace('Kadaluarsa');
    const oldRoot = await make(space.id, 'Lama');
    await uow.write(scopeA(), (tx) => tree.trash(tx, oldRoot.id));

    clock.advance(30 * DAY_MS - 60_000);
    const freshRoot = await make(space.id, 'Baru');
    await uow.write(scopeA(), (tx) => tree.trash(tx, freshRoot.id));
    await uow.write(scopeA(), (tx) => tree.purgeExpired(tx));
    await expect(uow.read(scopeA(), (tx) => tree.get(tx, oldRoot.id))).resolves.toMatchObject({ id: oldRoot.id });
    await expect(uow.read(scopeA(), (tx) => tree.get(tx, freshRoot.id))).resolves.toMatchObject({ id: freshRoot.id });

    clock.advance(2 * 60_000);
    const purged = await uow.write(scopeA(), (tx) => tree.purgeExpired(tx));
    expect(purged).toEqual({ roots: 1, count: 1 });
    await expect(uow.read(scopeA(), (tx) => tree.get(tx, oldRoot.id))).rejects.toMatchObject({
      code: 'entity_not_found',
    });
    await expect(uow.read(scopeA(), (tx) => tree.get(tx, freshRoot.id))).resolves.toMatchObject({ id: freshRoot.id });
  });

  it('each mutation publishes its entity event with the new revision', async () => {
    const from = await makeSpace('EventAsal');
    const to = await makeSpace('EventTujuan');
    captured.length = 0;
    const created = await make(from.id, 'Naskah');
    expect(captured[0]).toMatchObject({
      type: 'entity.created',
      aggregateId: created.id,
      aggregateRevision: 1,
      payload: { kind: KIND, spaceId: from.id, parentId: null },
    });

    const renamed = await uow.write(scopeA(), (tx) => tree.setTitle(tx, created.id, 'Judul baru'));
    expect(renamed.revision).toBe(2);
    expect(captured[1]).toMatchObject({
      type: 'entity.updated',
      aggregateId: created.id,
      aggregateRevision: 2,
      payload: { kind: KIND, fields: ['title'] },
    });

    const moved = await uow.write(scopeA(), (tx) =>
      tree.move(tx, {
        entityId: created.id,
        targetSpaceId: to.id,
        newParentId: null,
        beforeId: null,
        afterId: null,
      }),
    );
    expect(moved.revision).toBe(3);
    expect(captured[2]).toMatchObject({
      type: 'entity.moved',
      aggregateId: created.id,
      aggregateRevision: 3,
      payload: { kind: KIND, fromSpaceId: from.id, toSpaceId: to.id, fromParentId: null, toParentId: null },
    });

    const trashed = await uow.write(scopeA(), (tx) => tree.trash(tx, created.id));
    expect(trashed.rootId).toBe(created.id);
    expect(captured[3]).toMatchObject({
      type: 'entity.deleted',
      aggregateId: created.id,
      aggregateRevision: 4,
      payload: { kind: KIND, rootId: created.id },
    });

    const restored = await uow.write(scopeA(), (tx) => tree.restore(tx, created.id));
    expect(restored.count).toBe(1);
    expect(captured[4]).toMatchObject({
      type: 'entity.restored',
      aggregateId: created.id,
      aggregateRevision: 5,
      payload: { kind: KIND, rootId: created.id },
    });
    expect(captured).toHaveLength(5);
  });

  it('recordView does not change the revision', async () => {
    const space = await makeSpace('Dilihat');
    const page = await make(space.id, 'Halaman');
    expect(page.revision).toBe(1);
    await uow.write(scopeA(), (tx) => tree.recordView(tx, page.id));
    const after = await uow.read(scopeA(), (tx) => tree.get(tx, page.id));
    expect(after.revision).toBe(1);
    expect(after.updatedAt).toEqual(page.updatedAt);
  });

  it('owner B gets entity_not_found for an entity of owner A', async () => {
    const space = await makeSpace('Rahasia');
    const page = await make(space.id, 'Milik A');
    await expect(uow.read(scopeB(), (tx) => tree.get(tx, page.id))).rejects.toMatchObject({
      code: 'entity_not_found',
    });
  });

  it('trashRoots lists roots only with descendant count and purge date', async () => {
    const space = await makeSpace('Daftar');
    const parent = await make(space.id, 'Induk');
    await make(space.id, 'Anak1', parent.id);
    await make(space.id, 'Anak2', parent.id);
    const leaf = await make(space.id, 'Daun');
    await uow.write(scopeA(), (tx) => tree.trash(tx, parent.id));
    clock.advance(1000);
    await uow.write(scopeA(), (tx) => tree.trash(tx, leaf.id));

    const roots = await uow.read(scopeA(), (tx) => tree.trashRoots(tx));
    expect(roots).toHaveLength(2);
    expect(roots[0]).toMatchObject({
      rootId: leaf.id,
      title: 'Daun',
      spaceName: 'Daftar',
      parentTitle: null,
      descendantCount: 0,
      deletedAt: new Date(NOW.getTime() + 1000).toISOString(),
      purgeAt: new Date(NOW.getTime() + 1000 + 30 * DAY_MS).toISOString(),
    });
    expect(roots[1]).toMatchObject({
      rootId: parent.id,
      title: 'Induk',
      descendantCount: 2,
      deletedAt: NOW.toISOString(),
      purgeAt: new Date(NOW.getTime() + 30 * DAY_MS).toISOString(),
    });
  });

  it('subtreeCounts counts alive descendants only', async () => {
    const space = await makeSpace('Hitung');
    const parent = await make(space.id, 'P');
    const child = await make(space.id, 'C1', parent.id);
    const other = await make(space.id, 'C2', parent.id);
    const grand = await make(space.id, 'G', child.id);
    await uow.write(scopeA(), (tx) => tree.trash(tx, other.id));

    const counts = await uow.read(scopeA(), (tx) =>
      tree.subtreeCounts(tx, [parent.id, child.id, other.id, grand.id]),
    );
    expect(counts.get(parent.id)).toBe(2);
    expect(counts.get(child.id)).toBe(1);
    expect(counts.get(other.id)).toBe(0);
    expect(counts.get(grand.id)).toBe(0);
  });
});
