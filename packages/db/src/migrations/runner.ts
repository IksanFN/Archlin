import type { Logger } from '@archlin/kernel';
import { Kysely, PostgresDialect } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Migration } from 'kysely/migration';
import pg from 'pg';
import { readRecordedMigrations } from './schema-status';

export interface NamespacedMigrations {
  readonly namespace: string;
  // Key = local name, `<12-digit timestamp>_<snake_case>`.
  readonly migrations: Readonly<Record<string, Migration>>;
}

export const PLATFORM_NAMESPACE = 'platform';

// Arbitrary constant shared by every Archlin process; serializes whole migration runs across processes.
const MIGRATION_ADVISORY_LOCK_ID = 727274501;
const NAMESPACE_FORMAT = /^[a-z][a-z0-9]*$/;
const LOCAL_NAME_FORMAT = /^\d{12}_[a-z0-9_]+$/;

export class MigrationFailedError extends Error {
  override readonly name = 'MigrationFailedError';
  readonly migrationName: string | undefined;

  constructor(migrationName: string | undefined, options?: { cause?: unknown }) {
    super(migrationName === undefined ? 'Migration run failed' : `Migration failed: ${migrationName}`, options);
    this.migrationName = migrationName;
  }
}

// Validation happens before any connection is opened so a bad configuration fails fast and offline.
function assertValidSets(sets: readonly NamespacedMigrations[]): void {
  if (sets[0]?.namespace !== PLATFORM_NAMESPACE) {
    throw new Error(`The first migration set must be the "${PLATFORM_NAMESPACE}" namespace.`);
  }
  const seen = new Set<string>();
  for (const { namespace, migrations } of sets) {
    if (!NAMESPACE_FORMAT.test(namespace)) {
      throw new Error(`Invalid migration namespace "${namespace}".`);
    }
    if (seen.has(namespace)) {
      throw new Error(`Duplicate migration namespace "${namespace}".`);
    }
    seen.add(namespace);
    for (const name of Object.keys(migrations)) {
      if (!LOCAL_NAME_FORMAT.test(name)) {
        throw new Error(`Invalid migration name "${name}" in namespace "${namespace}".`);
      }
    }
  }
}

// Code-unit comparison: the order must not depend on the ICU locale of the machine that runs the migration.
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Execution order: namespace position in `sets` first (platform), then local name.
export function qualifiedMigrationNames(sets: readonly NamespacedMigrations[]): readonly string[] {
  return sets.flatMap(({ namespace, migrations }) =>
    Object.keys(migrations)
      .sort(compareText)
      .map((name) => `${namespace}:${name}`),
  );
}

export interface RunMigrationsOptions {
  readonly connectionString: string;
  readonly sets: readonly NamespacedMigrations[];
  readonly logger: Logger;
}

export async function runMigrations({
  connectionString,
  sets,
  logger,
}: RunMigrationsOptions): Promise<{ applied: readonly string[] }> {
  assertValidSets(sets);

  const order = qualifiedMigrationNames(sets);
  const known = new Map<string, Migration>();
  for (const { namespace, migrations } of sets) {
    for (const [name, migration] of Object.entries(migrations)) known.set(`${namespace}:${name}`, migration);
  }

  // The lock lives on its own connection for the whole run and is released in `finally`.
  const lockClient = new pg.Client({ connectionString, application_name: 'archlin-migrate-lock' });
  lockClient.on('error', (err) => logger.error({ err }, 'migration lock connection failed'));
  await lockClient.connect();
  const pool = new pg.Pool({ connectionString, max: 1, application_name: 'archlin-migrate' });
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });

  try {
    await lockClient.query('select pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);

    const applied: string[] = [];
    // Kysely sorts pending migrations alphabetically ("fixture:" before "platform:"), so each round gives it only
    // the next pending migration in our order. Each migration commits in its own transaction.
    for (;;) {
      const recorded = (await readRecordedMigrations(db)) ?? [];
      const done = new Set(recorded);
      const next = order.find((name) => !done.has(name));
      if (next === undefined) break;

      const provider: Record<string, Migration> = {};
      // A recorded name this build does not know is left out on purpose: Kysely then refuses to continue
      // ("previously executed migration is missing"), so an older build never migrates a newer schema.
      for (const name of recorded) {
        const migration = known.get(name);
        if (migration !== undefined) provider[name] = migration;
      }
      const pending = known.get(next);
      if (pending === undefined) throw new Error(`Migration ${next} is not registered.`);
      provider[next] = pending;

      const migrator = new Migrator({
        db,
        provider: { getMigrations: async () => provider },
        migrationTableName: 'kysely_migration',
        migrationLockTableName: 'kysely_migration_lock',
        // The recorded names are not a prefix of Kysely's alphabetical order (platform may run after fixture).
        allowUnorderedMigrations: true,
      });
      const { error, results = [] } = await migrator.migrateToLatest();

      if (error !== undefined) {
        const failed = results.find((r) => r.status === 'Error')?.migrationName;
        logger.error({ migration: failed, err: error }, 'migration failed');
        throw new MigrationFailedError(failed, { cause: error });
      }
      logger.info({ migration: next }, 'migration applied');
      applied.push(next);
    }

    logger.info({ count: applied.length }, 'migrations applied');
    return { applied };
  } finally {
    await db.destroy();
    // Ending the session drops the lock anyway, so a failed explicit unlock is only worth a warning.
    await lockClient
      .query('select pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID])
      .catch((err: unknown) => logger.warn({ err }, 'could not release the migration lock explicitly'));
    await lockClient.end();
  }
}
