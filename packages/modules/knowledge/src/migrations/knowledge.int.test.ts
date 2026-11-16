import { runMigrations } from '@archlin/db/migrations';
import { systemIds } from '@archlin/kernel';
import { platformMigrations } from '@archlin/platform/migrations';
import { assertModuleMigrationContract, createScratchDatabase, createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { noopLogger } from '@archlin/testing/fakes';
import { fixtureMigrations } from '@archlin/testing/fixture-module';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgeMigrations } from './index';

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

const HASH = 'ab'.repeat(32);
const KIND_PAGE = 'kb.page';
const KIND_FIXTURE = 'fixture.item';

describe('knowledge migrations', () => {
  let urls: TestDbUrls;
  let ownerA: string;
  let ownerB: string;

  beforeAll(async () => {
    ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [fixtureMigrations, knowledgeMigrations] }));
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

  const insertEntity = (ownerId: string, spaceId: string, kind: string) => {
    const id = newId();
    return run(urls.migrator, async (q) => {
      await q(
        `insert into public.entities (
           id, owner_id, kind, space_id, parent_id, position, title, created_at, updated_at
         ) values ($1, $2, $3, $4, null, $5, 'Item', now(), now())`,
        [id, ownerId, kind, spaceId, id],
      );
      return id;
    });
  };

  const insertNoteType = (ownerId: string) => {
    const id = newId();
    return run(urls.migrator, async (q) => {
      await q(
        `insert into public.kb_note_types (
           id, owner_id, key, name, template, field_schema, default_review_mode, is_system, position, created_at, updated_at
         ) values ($1, $2, $3, 'Tipe', '{}'::jsonb, '[]'::jsonb, 'none', false, $4, now(), now())`,
        [id, ownerId, `t_${id.replaceAll('-', '').slice(0, 8)}`, id],
      );
      return id;
    });
  };

  it('kb migrations satisfy the module migration contract', async () => {
    await assertModuleMigrationContract({
      urls,
      namespace: 'kb',
      tablesCreated: ['kb_note_types', 'kb_pages', 'kb_page_versions', 'kb_attachments', 'kb_attachment_refs'],
    });
  });

  it('kb.page is registered in entity_kinds', async () => {
    const result = await run(urls.migrator, (q) =>
      q(`select kind, module_id from public.entity_kinds where kind = $1`, [KIND_PAGE]),
    );
    expect(result.rows).toEqual([{ kind: KIND_PAGE, module_id: 'kb' }]);
  });

  it('kb_pages rejects a row whose entity has another kind', async () => {
    const spaceId = await insertSpace(ownerA);
    const entityId = await insertEntity(ownerA, spaceId, KIND_FIXTURE);
    const typeId = await insertNoteType(ownerA);
    await expect(
      run(urls.migrator, (q) =>
        q(
          `insert into public.kb_pages (
             owner_id, entity_id, kind, note_type_id, content, content_text, content_hash, last_saved_at
           ) values ($1, $2, $3, $4, '{}'::jsonb, '', $5, now())`,
          [ownerA, entityId, KIND_PAGE, typeId, HASH],
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('a page cannot use a note type of another owner', async () => {
    const spaceId = await insertSpace(ownerA);
    const entityId = await insertEntity(ownerA, spaceId, KIND_PAGE);
    const typeId = await insertNoteType(ownerB);
    await expect(
      run(urls.migrator, (q) =>
        q(
          `insert into public.kb_pages (
             owner_id, entity_id, kind, note_type_id, content, content_text, content_hash, last_saved_at
           ) values ($1, $2, $3, $4, '{}'::jsonb, '', $5, now())`,
          [ownerA, entityId, KIND_PAGE, typeId, HASH],
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('knowledge migrations seed existing accounts', () => {
  it('the migration seeds note types for accounts that already exist', async () => {
    const urls = await createScratchDatabase();
    await runMigrations({ connectionString: urls.migrator, sets: [platformMigrations], logger: noopLogger });

    const ownerId = systemIds.uuidv7();
    await run(urls.super, async (q) => {
      await q(
        `select public.auth_create_initial_account($1, $2, 'Test owner', 'not-a-real-hash', 'Asia/Jakarta', now())`,
        [ownerId, 'a@x.id'],
      );
    });

    await runMigrations({
      connectionString: urls.migrator,
      sets: [platformMigrations, knowledgeMigrations],
      logger: noopLogger,
    });

    const keys = await run(urls.migrator, (q) =>
      q(`select key from public.kb_note_types where owner_id = $1 order by position`, [ownerId]),
    );
    expect(keys.rows.map((row: { key: string }) => row.key)).toEqual([
      'runbook',
      'business_info',
      'work_log',
      'quick_note',
      'reference',
    ]);
  });
});
