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
import { createTagService } from './tag-service';
import { createTreeService } from './tree-service';

const KIND = 'fixture.item';
const NOW = new Date('2026-11-12T00:00:00.000Z');
const captured: EventEnvelope<unknown>[] = [];
const PLATFORM_EVENTS = [entityCreated, entityUpdated, entityMoved, entityDeleted, entityRestored];
const probeModule = defineModule({
  id: 'probe',
  eventHandlers: [
    defineHandler({
      id: 'onCreated',
      event: entityCreated,
      mode: 'sync',
      handle: async (event) => {
        captured.push(event);
      },
    }),
    defineHandler({
      id: 'onUpdated',
      event: entityUpdated,
      mode: 'sync',
      handle: async (event) => {
        captured.push(event);
      },
    }),
    defineHandler({
      id: 'onMoved',
      event: entityMoved,
      mode: 'sync',
      handle: async (event) => {
        captured.push(event);
      },
    }),
    defineHandler({
      id: 'onDeleted',
      event: entityDeleted,
      mode: 'sync',
      handle: async (event) => {
        captured.push(event);
      },
    }),
    defineHandler({
      id: 'onRestored',
      event: entityRestored,
      mode: 'sync',
      handle: async (event) => {
        captured.push(event);
      },
    }),
  ],
});
const registry = buildRegistry([fixtureModule, probeModule], PLATFORM_EVENTS);
const clock = new FakeClock(NOW);
const publisher = createEventPublisher({ registry, ids: systemIds, clock });
const spaces = createSpaceService({ registry, ids: systemIds, clock });
const tree = createTreeService({ registry, publisher, clock, ids: systemIds });
const tags = createTagService({ tree, ids: systemIds, clock });

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations] }));
  db = createDatabase({ connectionString: urls.app, applicationName: 'tag-service-test', max: 4 });
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
    await client.query('DELETE FROM public.tags');
    await client.query('DELETE FROM public.spaces');
  } finally {
    await client.end();
  }
});

const scopeA = () => issueOwnerScope(ownerA);
const scopeB = () => issueOwnerScope(ownerB);

const makeSpace = (name: string) => uow.write(scopeA(), (tx) => spaces.create(tx, { name, icon: null }));

const makeItem = (spaceId: string, title: string) =>
  uow.write(scopeA(), (tx) =>
    tree.create(tx, { kind: KIND, spaceId, parentId: null, title, icon: null, placement: 'last' }),
  );

describe('TagService', () => {
  it('reuses an existing tag case-insensitively and keeps its spelling', async () => {
    const space = await makeSpace('Ejaan');
    const first = await makeItem(space.id, 'Satu');
    const second = await makeItem(space.id, 'Dua');
    const original = await uow.write(scopeA(), (tx) => tags.setForEntity(tx, first.id, ['Hello']));
    const reused = await uow.write(scopeA(), (tx) => tags.setForEntity(tx, second.id, ['hello']));

    expect(original).toHaveLength(1);
    expect(reused).toEqual(original);
    expect(reused[0]?.name).toBe('Hello');
    const listed = await uow.read(scopeA(), (tx) => tags.forEntity(tx, second.id));
    expect(listed).toEqual(original);
  });

  it('parallel saves of a new tag name share one tag', async () => {
    const space = await makeSpace('TagBalapan');
    const items = await Promise.all(['A', 'B', 'C', 'D'].map((title) => makeItem(space.id, title)));
    const spellings = ['Rilis', 'rilis', 'RILIS', 'rIlIs'];
    const results = await Promise.all(
      items.map((item, i) => uow.write(scopeA(), (tx) => tags.setForEntity(tx, item.id, [spellings[i] ?? 'Rilis']))),
    );
    const [first] = results;
    expect(first).toHaveLength(1);
    for (const result of results) expect(result).toEqual(first);
    const stored = await uow.read(scopeA(), (tx) => tags.suggest(tx, 'ril'));
    expect(stored).toEqual(first);
  });

  it('drops case-insensitive duplicates in one request', async () => {
    const space = await makeSpace('Duplikat');
    const item = await makeItem(space.id, 'Item');
    const result = await uow.write(scopeA(), (tx) =>
      tags.setForEntity(tx, item.id, ['Project', 'project', 'PROJECT']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Project');
    const listed = await uow.read(scopeA(), (tx) => tags.forEntity(tx, item.id));
    expect(listed).toEqual(result);
  });

  it('suggest treats percent and underscore literally', async () => {
    const space = await makeSpace('Diskon');
    const item = await makeItem(space.id, 'Item');
    await uow.write(scopeA(), (tx) => tags.setForEntity(tx, item.id, ['50%-off', '50x']));

    const found = await uow.read(scopeA(), (tx) => tags.suggest(tx, '50%'));
    expect(found.map((tag) => tag.name)).toEqual(['50%-off']);
  });

  it('an unchanged tag set writes nothing and keeps the revision', async () => {
    const space = await makeSpace('Tetap');
    const item = await makeItem(space.id, 'Item');
    const first = await uow.write(scopeA(), (tx) => tags.setForEntity(tx, item.id, ['Alpha', 'Beta']));
    const afterFirst = await uow.read(scopeA(), (tx) => tree.get(tx, item.id));
    captured.length = 0;

    const second = await uow.write(scopeA(), (tx) => tags.setForEntity(tx, item.id, ['beta', 'ALPHA']));
    const afterSecond = await uow.read(scopeA(), (tx) => tree.get(tx, item.id));

    expect(second).toEqual(first);
    expect(second.map((tag) => tag.name)).toEqual(['Alpha', 'Beta']);
    expect(afterSecond.revision).toBe(afterFirst.revision);
    expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt);
    expect(captured).toHaveLength(0);
  });

  it("a changed tag set touches the entity with fields ['tags']", async () => {
    const space = await makeSpace('Ubah');
    const item = await makeItem(space.id, 'Item');
    await uow.write(scopeA(), (tx) => tags.setForEntity(tx, item.id, ['Alpha']));
    captured.length = 0;
    const before = await uow.read(scopeA(), (tx) => tree.get(tx, item.id));

    const result = await uow.write(scopeA(), (tx) => tags.setForEntity(tx, item.id, ['Alpha', 'Gamma']));
    const after = await uow.read(scopeA(), (tx) => tree.get(tx, item.id));

    expect(result.map((tag) => tag.name)).toEqual(['Alpha', 'Gamma']);
    expect(after.revision).toBe(before.revision + 1);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      type: 'entity.updated',
      aggregateId: item.id,
      aggregateRevision: after.revision,
      payload: { kind: KIND, fields: ['tags'] },
    });
  });

  it('tags of owner B are never suggested to owner A', async () => {
    const spaceA = await makeSpace('MilikA');
    const itemA = await makeItem(spaceA.id, 'A');
    await uow.write(scopeA(), (tx) => tags.setForEntity(tx, itemA.id, ['alpha']));

    const spaceB = await uow.write(scopeB(), (tx) => spaces.create(tx, { name: 'MilikB', icon: null }));
    const itemB = await uow.write(scopeB(), (tx) =>
      tree.create(tx, { kind: KIND, spaceId: spaceB.id, parentId: null, title: 'B', icon: null, placement: 'last' }),
    );
    await uow.write(scopeB(), (tx) => tags.setForEntity(tx, itemB.id, ['beta']));

    const fromA = await uow.read(scopeA(), (tx) => tags.suggest(tx, ''));
    const fromB = await uow.read(scopeB(), (tx) => tags.suggest(tx, ''));
    expect(fromA.map((tag) => tag.name)).toEqual(['alpha']);
    expect(fromB.map((tag) => tag.name)).toEqual(['beta']);
    expect(await uow.read(scopeA(), (tx) => tags.suggest(tx, 'b'))).toEqual([]);
  });

  it('setting tags on a trashed entity is rejected with entity_in_trash', async () => {
    const space = await makeSpace('Sampah');
    const item = await makeItem(space.id, 'Item');
    await uow.write(scopeA(), (tx) => tree.trash(tx, item.id));

    await expect(uow.write(scopeA(), (tx) => tags.setForEntity(tx, item.id, ['gone']))).rejects.toMatchObject({
      code: 'entity_in_trash',
    });
  });
});
