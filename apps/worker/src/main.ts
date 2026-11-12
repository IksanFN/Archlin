import { qualifiedMigrationNames } from '@archlin/db/migrations';
import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { buildRegistry, systemClock } from '@archlin/kernel';
import { createLogger } from '@archlin/platform/server';
import { PgBoss } from 'pg-boss';
import { migrationSets, modules } from '../../../archlin.config';
import { loadWorkerEnv, WorkerConfigError } from './env';
import { createPgBossQueue } from './pg-boss-queue';
import { createWorkerRuntime } from './runtime';

// Composition root of the worker: wires the database, the module registry and pg-boss, then runs until a signal.
async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const logger = createLogger({ level: env.logLevel, service: 'worker' });

  const db = createDatabase({
    connectionString: env.databaseUrl,
    applicationName: 'archlin-worker',
    onPoolError: (err) => logger.error({ err }, 'database pool error'),
  });
  const boss = new PgBoss({
    connectionString: env.databaseUrl,
    schema: 'pgboss',
    application_name: 'archlin-worker',
    // The schema and queues belong to apps/migrate; this process runs as cortex_app and cannot change them.
    migrate: false,
    createSchema: false,
    schedule: false,
    supervise: true,
  });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

  const runtime = createWorkerRuntime({
    db,
    uow: createOwnerUnitOfWork(db),
    registry: buildRegistry(modules.map((entry) => entry.server)),
    queue: createPgBossQueue(boss),
    clock: systemClock,
    logger,
    expectedMigrations: qualifiedMigrationNames(migrationSets()),
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await runtime.stop();
    await db.destroy();
  };
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));

  await runtime.start();
}

try {
  await main();
} catch (err) {
  if (err instanceof WorkerConfigError) {
    console.error(`Refusing to start (${err.code}): ${err.message}`);
  } else {
    createLogger({ level: 'error', service: 'worker' }).error({ err }, 'worker failed to start');
  }
  process.exit(1);
}
