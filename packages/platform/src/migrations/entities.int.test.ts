import { systemIds } from '@archlin/kernel';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { fixtureMigrations } from '@archlin/testing/fixture-module';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

type Query = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

async function run<T>(url: string, fn: (query: Query) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn((text, params) => client.query(text, params));
  } finally {
    await client.end();
  }
}

// Same shape as the runtime Unit of Work: one transaction with the owner set locally.
async function asOwner<T>(url: string, ownerId: string, fn: (query: Query) => Promise<T>): Promise<T> {
  return run(url, async (query) => {
    await query('BEGIN');
    try {
      await query(`select set_config('app.owner_id', $1, true)`, [ownerId]);
      const result = await fn(query);
      await query('COMMIT');
      return result;
    } catch (err) {
      await query('ROLLBACK');
      throw err;
    }
  });
}

const KIND = 'fixture.item';

describe('entities schema', () => {
  let urls: TestDbUrls;
  let ownerA: string;
  let ownerB: string;

  beforeAll(async () => {
    ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations] }));
  });

  const newId = () => systemIds.uuidv7();

  const insertSpace = (ownerId: string) => {
    const id = newId();
    const token = id.replaceAll('-', '').slice(0, 12);
    return run(urls.migrator, async (q) => {
      await q(
        `insert into public.spaces (id, owner_id, name, slug, position, created_at, updated_at)
         values ($1, $2, 'Space', $3, $4, now(), now())`,
        [id, ownerId, `s-${token}`, token],
      );
      return id;
    });
  };

  const insertEntity = (
    ownerId: string,
    spaceId: string,
    overrides: {
      id?: string;
      parentId?: string | null;
      position?: string;
      kind?: string;
      deletedAt?: string | null;
      deletedRootId?: string | null;
    } = {},
  ) => {
    const id = overrides.id ?? newId();
    return run(urls.migrator, async (q) => {
      await q(
        `insert into public.entities (
           id, owner_id, kind, space_id, parent_id, position, title, created_at, updated_at, deleted_at, deleted_root_id
         ) values ($1, $2, $3, $4, $5, $6, 'Item', now(), now(), $7, $8)`,
        [
          id,
          ownerId,
          overrides.kind ?? KIND,
          spaceId,
          overrides.parentId ?? null,
          overrides.position ?? id,
          overrides.deletedAt ?? null,
          overrides.deletedRootId ?? null,
        ],
      );
      return id;
    });
  };

  const insertTag = (ownerId: string) => {
    const id = newId();
    return run(urls.migrator, async (q) => {
      await q(`insert into public.tags (id, owner_id, name, created_at) values ($1, $2, $3, now())`, [
        id,
        ownerId,
        `tag-${id.replaceAll('-', '').slice(0, 8)}`,
      ]);
      return id;
    });
  };

  it('owner B cannot read or write spaces, entities, tags and entity_tags of owner A', async () => {
    const spaceId = await insertSpace(ownerA);
    const entityId = await insertEntity(ownerA, spaceId);
    const tagId = await insertTag(ownerA);
    await run(urls.migrator, (q) =>
      q(`insert into public.entity_tags (owner_id, entity_id, tag_id) values ($1, $2, $3)`, [ownerA, entityId, tagId]),
    );

    await asOwner(urls.app, ownerA, async (q) => {
      expect((await q('select id from public.spaces where id = $1', [spaceId])).rowCount).toBe(1);
      expect((await q('select id from public.entities where id = $1', [entityId])).rowCount).toBe(1);
      expect((await q('select id from public.tags where id = $1', [tagId])).rowCount).toBe(1);
      expect((await q('select tag_id from public.entity_tags where tag_id = $1', [tagId])).rowCount).toBe(1);
    });

    await asOwner(urls.app, ownerB, async (q) => {
      expect((await q('select id from public.spaces where id = $1', [spaceId])).rowCount).toBe(0);
      expect((await q('select id from public.entities where id = $1', [entityId])).rowCount).toBe(0);
      expect((await q('select id from public.tags where id = $1', [tagId])).rowCount).toBe(0);
      expect((await q('select tag_id from public.entity_tags where tag_id = $1', [tagId])).rowCount).toBe(0);
    });

    await expect(
      asOwner(urls.app, ownerB, (q) =>
        q(
          `insert into public.spaces (id, owner_id, name, slug, position, created_at, updated_at)
           values ($1, $2, 'X', 'stolen', 'z0', now(), now())`,
          [newId(), ownerA],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asOwner(urls.app, ownerB, (q) =>
        q(
          `insert into public.entities (id, owner_id, kind, space_id, parent_id, position, title, created_at, updated_at)
           values ($1, $2, $3, $4, null, 'z1', 'X', now(), now())`,
          [newId(), ownerA, KIND, spaceId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asOwner(urls.app, ownerB, (q) =>
        q(`insert into public.tags (id, owner_id, name, created_at) values ($1, $2, 'stolen', now())`, [newId(), ownerA]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asOwner(urls.app, ownerB, (q) =>
        q(`insert into public.entity_tags (owner_id, entity_id, tag_id) values ($1, $2, $3)`, [ownerA, entityId, tagId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('an entity cannot point at a space or a parent of another owner', async () => {
    const spaceA = await insertSpace(ownerA);
    const spaceB = await insertSpace(ownerB);
    const parentB = await insertEntity(ownerB, spaceB);

    await expect(insertEntity(ownerA, spaceB)).rejects.toMatchObject({ code: '23503' });
    await expect(insertEntity(ownerA, spaceA, { parentId: parentB })).rejects.toMatchObject({ code: '23503' });
  });

  it('a parent must live in the same space', async () => {
    const space1 = await insertSpace(ownerA);
    const space2 = await insertSpace(ownerA);
    const parent = await insertEntity(ownerA, space1);

    await expect(insertEntity(ownerA, space2, { parentId: parent })).rejects.toMatchObject({
      code: '23503',
      constraint: 'entities_parent_fk',
    });
  });

  it('changing the space of a parent carries every descendant, trashed ones included', async () => {
    const fromSpace = await insertSpace(ownerA);
    const toSpace = await insertSpace(ownerA);
    const root = await insertEntity(ownerA, fromSpace, { position: 'a0' });
    const child = await insertEntity(ownerA, fromSpace, { parentId: root, position: 'a0' });
    const grandchildId = newId();
    await insertEntity(ownerA, fromSpace, {
      id: grandchildId,
      parentId: child,
      position: 'a0',
      deletedAt: new Date().toISOString(),
      deletedRootId: grandchildId,
    });

    await run(urls.migrator, (q) =>
      q(`update public.entities set space_id = $1, parent_id = null where id = $2`, [toSpace, root]),
    );

    const row = (id: string) =>
      run(urls.migrator, (q) => q(`select space_id, parent_id, deleted_at from public.entities where id = $1`, [id])).then(
        (r) => r.rows[0],
      );

    expect(await row(root)).toMatchObject({ space_id: toSpace, parent_id: null });
    expect(await row(child)).toMatchObject({ space_id: toSpace, parent_id: root, deleted_at: null });
    const grandchild = await row(grandchildId);
    expect(grandchild).toMatchObject({ space_id: toSpace, parent_id: child });
    expect(grandchild.deleted_at).not.toBeNull();
  });

  it('deleting a parent releases a child to the space root', async () => {
    const spaceId = await insertSpace(ownerA);
    const parent = await insertEntity(ownerA, spaceId, { position: 'a0' });
    const child = await insertEntity(ownerA, spaceId, { parentId: parent, position: 'a0' });

    await run(urls.migrator, (q) => q(`delete from public.entities where id = $1`, [parent]));

    const remaining = await run(urls.migrator, (q) =>
      q(`select parent_id, owner_id from public.entities where id = $1`, [child]),
    );
    expect(remaining.rows[0]).toMatchObject({ parent_id: null, owner_id: ownerA });
  });

  it('alive siblings cannot share a position, also at the space root', async () => {
    const spaceId = await insertSpace(ownerA);
    const first = await insertEntity(ownerA, spaceId, { position: 'a0' });

    await expect(insertEntity(ownerA, spaceId, { position: 'a0' })).rejects.toMatchObject({
      code: '23505',
      constraint: 'entities_sibling_position_uk',
    });

    const trashed = await insertEntity(ownerA, spaceId, {
      position: 'a0',
      deletedAt: new Date().toISOString(),
      deletedRootId: first,
    });
    expect(trashed).toEqual(expect.any(String));
  });

  it('an entity kind must be registered', async () => {
    const spaceId = await insertSpace(ownerA);
    await expect(insertEntity(ownerA, spaceId, { kind: 'nope.thing' })).rejects.toMatchObject({ code: '23503' });
  });

  it('cortex_app cannot write entity_kinds', async () => {
    const readable = await run(urls.app, (q) => q(`select kind from public.entity_kinds where kind = $1`, [KIND]));
    expect(readable.rowCount).toBe(1);

    await expect(
      run(urls.app, (q) => q(`insert into public.entity_kinds (kind, module_id) values ('nope.thing', 'nope')`)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      run(urls.app, (q) => q(`update public.entity_kinds set module_id = 'x' where kind = $1`, [KIND])),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(run(urls.app, (q) => q(`delete from public.entity_kinds where kind = $1`, [KIND]))).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('deleted_at and deleted_root_id are set together', async () => {
    const spaceId = await insertSpace(ownerA);
    const live = await insertEntity(ownerA, spaceId);

    await expect(
      insertEntity(ownerA, spaceId, { deletedAt: new Date().toISOString(), position: 'x1' }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'entities_trash_pair' });
    await expect(insertEntity(ownerA, spaceId, { deletedRootId: live, position: 'x2' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'entities_trash_pair',
    });
  });
});
