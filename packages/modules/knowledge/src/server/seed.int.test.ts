import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { sqlFor } from '@archlin/db/scoped';
import { buildRegistry, systemIds } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { accountCreated, createEventPublisher, PLATFORM_EVENTS } from '@archlin/platform/server';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { FakeClock } from '@archlin/testing/fakes';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { knowledgeMigrations } from '../migrations';
import { createKnowledgeModule } from './module';
import type { KnowledgeDatabase } from './schema';
import { seedSystemNoteTypes } from './seed';

const SYSTEM_KEYS = ['runbook', 'business_info', 'work_log', 'quick_note', 'reference'];
const NOW = new Date('2026-11-12T10:00:00.000Z');

async function keysFor(url: string, ownerId: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query(`select key from public.kb_note_types where owner_id = $1 order by position`, [
      ownerId,
    ]);
    return result.rows.map((row: { key: string }) => row.key);
  } finally {
    await client.end();
  }
}

describe('system note type seed', () => {
  let urls: TestDbUrls;
  let ownerA: string;
  let ownerB: string;
  let db: ReturnType<typeof createDatabase>;
  let uow: ReturnType<typeof createOwnerUnitOfWork>;

  beforeAll(async () => {
    ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [knowledgeMigrations] }));
    db = createDatabase({ connectionString: urls.app, applicationName: 'kb-seed-test', max: 2 });
    uow = createOwnerUnitOfWork(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('seeding twice keeps five system types', async () => {
    const scope = issueOwnerScope(ownerA);
    await uow.write(scope, async (tx) => {
      const first = await seedSystemNoteTypes(sqlFor<KnowledgeDatabase>(tx), ownerA, systemIds, NOW);
      const second = await seedSystemNoteTypes(sqlFor<KnowledgeDatabase>(tx), ownerA, systemIds, NOW);
      expect(first).toBe(5);
      expect(second).toBe(0);
    });
    expect(await keysFor(urls.migrator, ownerA)).toEqual(SYSTEM_KEYS);
  });

  it('account creation seeds the five types through platform.account.created', async () => {
    const publisher = createEventPublisher({
      registry: buildRegistry([createKnowledgeModule({ ids: systemIds })], PLATFORM_EVENTS),
      ids: systemIds,
      clock: new FakeClock(NOW),
    });
    const scope = issueOwnerScope(ownerB);
    await uow.write(scope, (tx) =>
      publisher.publish(
        { definition: accountCreated, aggregateId: ownerB, aggregateRevision: 1, payload: {} },
        tx,
      ),
    );
    expect(await keysFor(urls.migrator, ownerB)).toEqual(SYSTEM_KEYS);
  });
});
