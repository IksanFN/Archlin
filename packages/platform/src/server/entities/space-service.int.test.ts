import { randomUUID } from 'node:crypto';
import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { buildRegistry, systemIds } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { FakeClock } from '@archlin/testing/fakes';
import { fixtureMigrations, fixtureModule } from '@archlin/testing/fixture-module';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSpaceService } from './space-service';

const KIND = 'fixture.item';
const NOW = new Date('2026-11-12T00:00:00.000Z');

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;
const spaces = createSpaceService({
  registry: buildRegistry([fixtureModule]),
  ids: systemIds,
  clock: new FakeClock(NOW),
});

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations] }));
  db = createDatabase({ connectionString: urls.app, applicationName: 'space-service-test', max: 4 });
  uow = createOwnerUnitOfWork(db);
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
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

const create = (name: string, icon: string | null = null) =>
  uow.write(scopeA(), (tx) => spaces.create(tx, { name, icon }));

async function insertItem(spaceId: string, deleted: boolean): Promise<void> {
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    const id = systemIds.uuidv7();
    await client.query(
      `insert into public.entities (
         id, owner_id, kind, space_id, parent_id, position, title, created_at, updated_at, deleted_at, deleted_root_id
       ) values ($1, $2, $3, $4, null, $5, 'Item', now(), now(), $6, $7)`,
      [id, ownerA, KIND, spaceId, id, deleted ? NOW.toISOString() : null, deleted ? id : null],
    );
  } finally {
    await client.end();
  }
}

describe('SpaceService', () => {
  it('create picks the next free slug', async () => {
    const first = await create('Kerja');
    const second = await create('Kérja');
    const third = await create('Kerja!');
    expect([first, second, third].map((space) => space.slug)).toEqual(['kerja', 'kerja-2', 'kerja-3']);
  });

  it('list returns spaces in position order and hides archived ones unless asked', async () => {
    const alpha = await create('Alpha');
    const beta = await create('Beta');
    const gamma = await create('Gamma');
    await uow.write(scopeA(), (tx) => spaces.archive(tx, beta.id));

    const listed = await uow.read(scopeA(), (tx) => spaces.list(tx, { includeArchived: false }));
    expect(listed.map((space) => space.id)).toEqual([alpha.id, gamma.id]);

    const withArchived = await uow.read(scopeA(), (tx) => spaces.list(tx, { includeArchived: true }));
    expect(withArchived.map((space) => space.id)).toEqual([alpha.id, beta.id, gamma.id]);
    expect(withArchived[1]?.archivedAt).toBe(NOW.toISOString());
  });

  it('rename keeps the slug', async () => {
    const created = await create('Stable Name');
    const updated = await uow.write(scopeA(), (tx) => spaces.update(tx, { id: created.id, name: 'Tim' }));
    expect(updated.slug).toBe(created.slug);
    expect(updated.name).toBe('Tim');
    const bySlug = await uow.read(scopeA(), (tx) => spaces.getBySlug(tx, created.slug));
    expect(bySlug.id).toBe(created.id);
    expect(bySlug.name).toBe('Tim');
  });

  it('reorder moves a space before another', async () => {
    const alpha = await create('Reorder Alpha');
    const beta = await create('Reorder Beta');
    const gamma = await create('Reorder Gamma');
    await uow.write(scopeA(), (tx) => spaces.reorder(tx, { id: gamma.id, beforeId: alpha.id, afterId: null }));

    const listed = await uow.read(scopeA(), (tx) => spaces.list(tx, { includeArchived: false }));
    expect(listed.map((space) => space.id)).toEqual([gamma.id, alpha.id, beta.id]);
  });

  it('reorder with an unknown sibling is rejected with invalid_sibling', async () => {
    const space = await create('Saudara Asing');
    await expect(
      uow.write(scopeA(), (tx) => spaces.reorder(tx, { id: space.id, beforeId: randomUUID(), afterId: null })),
    ).rejects.toMatchObject({ code: 'invalid_sibling' });
  });

  it('parallel creates of the same name get different slugs', async () => {
    const results = await Promise.all([
      uow.write(scopeA(), (tx) => spaces.create(tx, { name: 'Paralel', icon: null })),
      uow.write(scopeA(), (tx) => spaces.create(tx, { name: 'Paralel', icon: null })),
    ]);
    expect(results.map((space) => space.slug).sort()).toEqual(['paralel', 'paralel-2']);
  });

  it('pageCount counts alive treeable entities only', async () => {
    const space = await create('Counted');
    await insertItem(space.id, false);
    await insertItem(space.id, false);
    await insertItem(space.id, true);
    const got = await uow.read(scopeA(), (tx) => spaces.get(tx, space.id));
    expect(got.pageCount).toBe(2);
  });

  it('owner B gets space_not_found for a space of owner A', async () => {
    const created = await create('Rahasia');
    await expect(uow.read(scopeB(), (tx) => spaces.get(tx, created.id))).rejects.toMatchObject({
      code: 'space_not_found',
      message: 'Space tidak ditemukan',
    });
    await expect(uow.read(scopeB(), (tx) => spaces.getBySlug(tx, created.slug))).rejects.toMatchObject({
      code: 'space_not_found',
    });
  });
});
