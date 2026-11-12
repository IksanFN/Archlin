import { runMigrations } from '@archlin/db/migrations';
import { assertModuleMigrationContract, createScratchDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { noopLogger } from '@archlin/testing/fakes';
import { fixtureMigrations } from '@archlin/testing/fixture-module';
import pg from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { platformMigrations } from './index';

let urls: TestDbUrls;

async function publicTables(): Promise<string[]> {
  const client = new pg.Client({ connectionString: urls.super });
  await client.connect();
  try {
    const { rows } = await client.query(`select tablename from pg_tables where schemaname = 'public' order by tablename`);
    return rows.map((r: { tablename: string }) => r.tablename);
  } finally {
    await client.end();
  }
}

async function asSuper(statements: string[]): Promise<void> {
  const client = new pg.Client({ connectionString: urls.super });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

beforeEach(async () => {
  urls = await createScratchDatabase();
});

describe('assertModuleMigrationContract', () => {
  it('accepts the platform tables and the fixture module tables', async () => {
    await runMigrations({ connectionString: urls.migrator, sets: [platformMigrations], logger: noopLogger });
    const platformTables = await publicTables();
    await runMigrations({ connectionString: urls.migrator, sets: [platformMigrations, fixtureMigrations], logger: noopLogger });
    const fixtureTables = (await publicTables()).filter((t) => !platformTables.includes(t));

    expect(fixtureTables).toEqual(['fixture_audit', 'fixture_pings', 'fixture_switches', 'fixture_sync_marks']);
    await assertModuleMigrationContract({ urls, namespace: 'fixture', tablesCreated: fixtureTables });
    await assertModuleMigrationContract({ urls, namespace: 'platform', tablesCreated: platformTables });
  });

  describe('rejects a module table that', () => {
    // A correct table first, so each case isolates exactly one broken rule.
    const goodTable = (name: string) => [
      `create table public.${name} (owner_id uuid not null references public.users (id) on delete cascade)`,
      `alter table public.${name} enable row level security`,
      `create policy ${name}_owner on public.${name} for all to cortex_app
         using (owner_id = nullif(current_setting('app.owner_id', true), '')::uuid)
         with check (owner_id = nullif(current_setting('app.owner_id', true), '')::uuid)`,
      `grant select, insert, update on public.${name} to cortex_app`,
    ];
    const check = (tablesCreated: string[] = ['fixture_bad']) =>
      assertModuleMigrationContract({ urls, namespace: 'fixture', tablesCreated });

    beforeEach(async () => {
      await runMigrations({ connectionString: urls.migrator, sets: [platformMigrations], logger: noopLogger });
    });

    it('passes when every rule is met', async () => {
      await asSuper(goodTable('fixture_bad'));
      await expect(check()).resolves.toBeUndefined();
    });

    it('has an owner column but no row level security', async () => {
      await asSuper(['create table public.fixture_bad (owner_id uuid not null)']);
      await expect(check()).rejects.toThrow(/fixture_bad.*row level security/is);
    });

    it('has row level security but a policy that ignores the owner setting', async () => {
      await asSuper([
        'create table public.fixture_bad (owner_id uuid not null)',
        'alter table public.fixture_bad enable row level security',
        'create policy fixture_bad_all on public.fixture_bad for all to cortex_app using (true) with check (true)',
        'grant select on public.fixture_bad to cortex_app',
      ]);
      await expect(check()).rejects.toThrow(/fixture_bad.*app\.owner_id/is);
    });

    it('has row level security but no policy for cortex_app at all', async () => {
      await asSuper([
        'create table public.fixture_bad (owner_id uuid not null)',
        'alter table public.fixture_bad enable row level security',
      ]);
      await expect(check()).rejects.toThrow(/fixture_bad.*policy/is);
    });

    it('grants TRUNCATE to cortex_app', async () => {
      await asSuper([...goodTable('fixture_bad'), 'grant truncate on public.fixture_bad to cortex_app']);
      await expect(check()).rejects.toThrow(/fixture_bad.*truncate/is);
    });

    it('grants REFERENCES or TRIGGER to cortex_app', async () => {
      await asSuper([...goodTable('fixture_bad'), 'grant references, trigger on public.fixture_bad to cortex_app']);
      await expect(check()).rejects.toThrow(/fixture_bad.*(references|trigger)/is);
    });

    it('is owned by cortex_app', async () => {
      await asSuper([...goodTable('fixture_bad'), 'alter table public.fixture_bad owner to cortex_app']);
      await expect(check()).rejects.toThrow(/fixture_bad.*owned by cortex_app/is);
    });

    it('grants a privilege to PUBLIC', async () => {
      await asSuper([...goodTable('fixture_bad'), 'grant select on public.fixture_bad to public']);
      await expect(check()).rejects.toThrow(/fixture_bad.*PUBLIC/s);
    });

    it('is not prefixed with the module namespace', async () => {
      await asSuper(goodTable('other_table'));
      await expect(check(['other_table'])).rejects.toThrow(/other_table.*fixture_/s);
    });

    it('lets cortex_app touch a pre-auth table', async () => {
      await asSuper(['grant select on public.auth_attempts to cortex_app']);
      await expect(assertModuleMigrationContract({ urls, namespace: 'platform', tablesCreated: [] })).rejects.toThrow(
        /auth_attempts.*cortex_app/s,
      );
    });
  });
});
