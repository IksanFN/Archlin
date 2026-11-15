import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { buildRegistry, systemIds } from '@archlin/kernel';
import type { ReadTx, WriteTx } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { FakeClock } from '@archlin/testing/fakes';
import { fixtureMigrations, fixtureModule } from '@archlin/testing/fixture-module';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LinkRef } from '../../contracts';
import { PLATFORM_EVENTS } from '../platform-events';
import { createEventPublisher } from '../events';
import { createSpaceService } from '../entities/space-service';
import { createTreeService } from '../entities/tree-service';
import type { EntityRecord } from '../entities/tree-service';
import { createLinkService } from './link-service';

const ITEM = 'fixture.item';
const PART = 'fixture.part';
const NOW = new Date('2026-11-16T00:00:00.000Z');

const registry = buildRegistry([fixtureModule], PLATFORM_EVENTS);
const clock = new FakeClock(NOW);
const publisher = createEventPublisher({ registry, ids: systemIds, clock });
const spaces = createSpaceService({ registry, ids: systemIds, clock });
const tree = createTreeService({ registry, publisher, clock, ids: systemIds });
const links = createLinkService({ registry, ids: systemIds, clock });

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;
let spaceId: string;
let source: EntityRecord;

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations] }));
  db = createDatabase({ connectionString: urls.app, applicationName: 'link-service-test', max: 4 });
  uow = createOwnerUnitOfWork(db);
});

afterAll(async () => {
  await db.destroy();
});

const write = <T>(work: (tx: WriteTx) => Promise<T>) => uow.write(issueOwnerScope(ownerA), work);
const read = <T>(work: (tx: ReadTx) => Promise<T>) => uow.read(issueOwnerScope(ownerA), work);
const readAs = <T>(owner: string, work: (tx: ReadTx) => Promise<T>) => uow.read(issueOwnerScope(owner), work);

const createItem = (title: string, inSpace = spaceId) =>
  write((tx) => tree.create(tx, { kind: ITEM, spaceId: inSpace, parentId: null, title, icon: null, placement: 'last' }));
const createPart = (parentId: string, title: string) =>
  write((tx) => tree.create(tx, { kind: PART, spaceId, parentId, title, icon: null, placement: 'last' }));
const ref = (partial: Partial<LinkRef> & Pick<LinkRef, 'targetId' | 'targetTitle'>): LinkRef => ({
  kind: 'wikilink',
  snippet: '',
  ...partial,
});
const sync = (sourceId: string, refs: LinkRef[]) =>
  write((tx) => links.sync(tx, { sourceId, spaceId, refs }));

beforeEach(async () => {
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    await client.query('DELETE FROM public.entities');
    await client.query('DELETE FROM public.spaces');
  } finally {
    await client.end();
  }
  spaceId = (await write((tx) => spaces.create(tx, { name: 'Utama', icon: null }))).id;
  source = await createItem('Sumber');
});

describe('LinkService', () => {
  it('sync stores an id link and keeps it through a rename of the target', async () => {
    const target = await createItem('Rollback Postgres');
    await sync(source.id, [ref({ targetId: target.id, targetTitle: 'Rollback Postgres' })]);
    await write((tx) => tree.setTitle(tx, target.id, 'Rollback Postgres 16'));
    expect((await read((tx) => links.outbound(tx, source.id)))[0]).toMatchObject({
      key: target.id,
      target: { id: target.id, title: 'Rollback Postgres 16' },
    });
  });

  it('a title link resolved once stays resolved after the target is renamed and a stale tab saves again', async () => {
    await sync(source.id, [ref({ targetId: null, targetTitle: 'Deploy' })]);
    const target = await createItem('Deploy');
    await write((tx) => links.resolvePending(tx, { entityId: target.id, title: 'Deploy' }));
    await write((tx) => tree.setTitle(tx, target.id, 'Deploy ke production'));
    await sync(source.id, [ref({ targetId: null, targetTitle: 'Deploy' })]);
    expect((await read((tx) => links.outbound(tx, source.id)))[0]).toMatchObject({
      key: 't:deploy',
      target: { id: target.id },
    });
  });

  it('sync leaves an ambiguous title unresolved and outbound marks it ambiguous', async () => {
    await createItem('Catatan');
    await createItem('Catatan');
    await sync(source.id, [ref({ targetId: null, targetTitle: 'catatan' })]);
    expect((await read((tx) => links.outbound(tx, source.id)))[0]).toMatchObject({ target: null, ambiguous: true });
  });

  it('sync resolves a title that has exactly one live match', async () => {
    const target = await createItem('Deploy');
    await sync(source.id, [ref({ targetId: null, targetTitle: '  deploy ' })]);
    expect((await read((tx) => links.outbound(tx, source.id)))[0]).toMatchObject({
      key: 't:deploy',
      targetTitle: 'deploy',
      target: { id: target.id, trashed: false },
      ambiguous: false,
    });
  });

  it('an id of a non-treeable entity or of another owner is treated as a title', async () => {
    const part = await createPart(source.id, 'a.pdf');
    await sync(source.id, [ref({ targetId: part.id, targetTitle: 'Tidak ada' })]);
    expect((await read((tx) => links.outbound(tx, source.id)))[0]).toMatchObject({ key: 't:tidak ada', target: null });

    const otherSpace = await uow.write(issueOwnerScope(ownerB), (tx) => spaces.create(tx, { name: 'B', icon: null }));
    const foreign = await uow.write(issueOwnerScope(ownerB), (tx) =>
      tree.create(tx, { kind: ITEM, spaceId: otherSpace.id, parentId: null, title: 'Milik B', icon: null, placement: 'last' }),
    );
    await sync(source.id, [ref({ targetId: foreign.id, targetTitle: 'Tidak ada' })]);
    expect((await read((tx) => links.outbound(tx, source.id)))[0]?.target).toBeNull();
  });

  it('purging the target turns the link unresolved with its title', async () => {
    const target = await createItem('Lama');
    await sync(source.id, [ref({ targetId: target.id, targetTitle: 'Lama' })]);
    await write((tx) => tree.trash(tx, target.id));
    expect((await read((tx) => links.outbound(tx, source.id)))[0]?.target?.trashed).toBe(true);
    await write((tx) => tree.purge(tx, target.id));
    expect((await read((tx) => links.outbound(tx, source.id)))[0]).toMatchObject({ key: 't:lama', target: null });
  });

  it('inbound lists live sources once, including unresolved links whose title matches', async () => {
    const target = await createItem('Rollback');
    const a = await createItem('Checklist');
    const b = await createItem('Insiden');
    await sync(a.id, [
      ref({ targetId: target.id, targetTitle: 'Rollback', snippet: 'ikuti [[Rollback]]' }),
      ref({ targetId: target.id, targetTitle: 'Rollback' }),
    ]);
    await sync(b.id, [ref({ targetId: null, targetTitle: 'rollback' })]);
    await sync(source.id, [ref({ targetId: target.id, targetTitle: 'Rollback' })]);
    await write((tx) => tree.trash(tx, source.id));
    const inbound = await read((tx) => links.inbound(tx, { entityId: target.id, title: 'Rollback' }));
    expect(inbound.map((link) => link.title)).toEqual(['Checklist', 'Insiden']);
    expect(inbound[0]?.snippet).toBe('ikuti [[Rollback]]');
  });

  it('resolvePending connects waiting links of other pages and reports how many', async () => {
    await sync(source.id, [ref({ targetId: null, targetTitle: 'Freeze rilis' })]);
    const target = await createItem('Freeze rilis');
    expect(await write((tx) => links.resolvePending(tx, { entityId: target.id, title: 'Freeze rilis' }))).toBe(1);
    expect(await write((tx) => links.resolvePending(tx, { entityId: target.id, title: 'Freeze rilis' }))).toBe(0);
    expect((await read((tx) => links.outbound(tx, source.id)))[0]?.target?.id).toBe(target.id);
  });

  it('resolvePending leaves links alone when the title is ambiguous', async () => {
    await sync(source.id, [ref({ targetId: null, targetTitle: 'Catatan' })]);
    const first = await createItem('Catatan');
    await createItem('Catatan');
    expect(await write((tx) => links.resolvePending(tx, { entityId: first.id, title: 'Catatan' }))).toBe(0);
  });

  it('sync rejects a link title longer than 500 characters', async () => {
    await expect(sync(source.id, [ref({ targetId: null, targetTitle: 'x'.repeat(501) })])).rejects.toMatchObject({
      code: 'link_title_too_long',
    });
  });

  it('sync replaces the previous links of the source and skips empty titles', async () => {
    await sync(source.id, [ref({ targetId: null, targetTitle: 'Satu' }), ref({ targetId: null, targetTitle: 'Dua' })]);
    await sync(source.id, [ref({ targetId: null, targetTitle: '   ' }), ref({ targetId: null, targetTitle: 'Tiga' })]);
    expect((await read((tx) => links.outbound(tx, source.id))).map((link) => link.targetTitle)).toEqual(['Tiga']);
  });

  it('owner B never sees links of owner A', async () => {
    await sync(source.id, [ref({ targetId: null, targetTitle: 'Rahasia' })]);
    expect(await readAs(ownerB, (tx) => links.outbound(tx, source.id))).toEqual([]);
  });
});
