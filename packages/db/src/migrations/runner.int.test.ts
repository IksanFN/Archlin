import { createScratchDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { noopLogger } from '@archlin/testing/fakes';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { MigrationFailedError, qualifiedMigrationNames, readSchemaStatus, runMigrations } from './index';
import type { NamespacedMigrations } from './index';

const set = (namespace: string, names: string[]): NamespacedMigrations => ({
  namespace,
  migrations: Object.fromEntries(
    names.map((n) => [
      n,
      {
        up: async (db) => {
          await sql`create table ${sql.table(`${namespace}_${n.slice(13)}`)} (id int)`.execute(db);
        },
      },
    ]),
  ),
});

let urls: TestDbUrls;
const logger = noopLogger;

beforeEach(async () => {
  urls = await createScratchDatabase();
});

async function withDb<T>(fn: (db: Kysely<unknown>) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: urls.migrator, max: 1 });
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  try {
    return await fn(db);
  } finally {
    await db.destroy();
  }
}

describe('runMigrations', () => {
  it('runs platform migrations before module migrations even when module names sort first', async () => {
    const { applied } = await runMigrations({
      connectionString: urls.migrator,
      logger,
      sets: [set('platform', ['202611111200_a']), set('fixture', ['202601010000_b'])],
    });
    expect(applied).toEqual(['platform:202611111200_a', 'fixture:202601010000_b']);
  });

  it('applies a platform migration added after a module migration already ran', async () => {
    await runMigrations({
      connectionString: urls.migrator,
      logger,
      sets: [set('platform', ['202611111200_a']), set('fixture', ['202601010000_b'])],
    });
    const { applied } = await runMigrations({
      connectionString: urls.migrator,
      logger,
      sets: [set('platform', ['202611111200_a', '202611111300_c']), set('fixture', ['202601010000_b'])],
    });
    expect(applied).toEqual(['platform:202611111300_c']);
  });

  it('applies nothing when everything has already run', async () => {
    const sets = [set('platform', ['202611111200_a'])];
    await runMigrations({ connectionString: urls.migrator, logger, sets });
    expect((await runMigrations({ connectionString: urls.migrator, logger, sets })).applied).toEqual([]);
  });

  it('serializes concurrent runs so each migration applies once', async () => {
    const sets = [set('platform', ['202611111200_a'])];
    const results = await Promise.all([
      runMigrations({ connectionString: urls.migrator, sets, logger }),
      runMigrations({ connectionString: urls.migrator, sets, logger }),
    ]);
    expect(results.flatMap((r) => r.applied)).toEqual(['platform:202611111200_a']);
  });

  it('reports the failing migration name and keeps earlier migrations applied', async () => {
    const failing: NamespacedMigrations = {
      namespace: 'platform',
      migrations: {
        '202611111100_ok': {
          up: async (db) => {
            await sql`create table platform_ok (id int)`.execute(db);
          },
        },
        '202611111200_bad': {
          up: async () => {
            throw new Error('boom');
          },
        },
      },
    };
    const error = await runMigrations({ connectionString: urls.migrator, logger, sets: [failing] }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MigrationFailedError);
    expect((error as MigrationFailedError).migrationName).toBe('platform:202611111200_bad');
    await withDb(async (db) => {
      const { rows } = await sql<{ name: string }>`select name from kysely_migration order by name`.execute(db);
      expect(rows.map((r) => r.name)).toEqual(['platform:202611111100_ok']);
    });
  });

  it('releases the advisory lock after a failed run', async () => {
    const bad: NamespacedMigrations = {
      namespace: 'platform',
      migrations: {
        '202611111200_bad': {
          up: async () => {
            throw new Error('boom');
          },
        },
      },
    };
    await expect(runMigrations({ connectionString: urls.migrator, logger, sets: [bad] })).rejects.toBeInstanceOf(
      MigrationFailedError,
    );
    const { applied } = await runMigrations({
      connectionString: urls.migrator,
      logger,
      sets: [set('platform', ['202611111300_good'])],
    });
    expect(applied).toEqual(['platform:202611111300_good']);
  });
});

describe('readSchemaStatus', () => {
  const sets = [set('platform', ['202611111200_a', '202611111300_c'])];

  it('reports every migration as pending before the first run', async () => {
    const expected = qualifiedMigrationNames(sets);
    await withDb(async (db) => {
      expect(await readSchemaStatus(db, expected)).toEqual({ status: 'pending', missing: expected });
    });
  });

  it('reports pending for the missing part and ok once everything has run', async () => {
    await runMigrations({ connectionString: urls.migrator, logger, sets: [set('platform', ['202611111200_a'])] });
    const expected = qualifiedMigrationNames(sets);
    await withDb(async (db) => {
      expect(await readSchemaStatus(db, expected)).toEqual({ status: 'pending', missing: ['platform:202611111300_c'] });
    });
    await runMigrations({ connectionString: urls.migrator, logger, sets });
    await withDb(async (db) => {
      expect(await readSchemaStatus(db, expected)).toEqual({ status: 'ok' });
    });
  });

  it('reports unknown migrations when the schema is newer than the build', async () => {
    await runMigrations({ connectionString: urls.migrator, logger, sets });
    await withDb(async (db) => {
      expect(await readSchemaStatus(db, ['platform:202611111200_a'])).toEqual({
        status: 'unknown_migrations',
        unknown: ['platform:202611111300_c'],
      });
    });
  });
});
