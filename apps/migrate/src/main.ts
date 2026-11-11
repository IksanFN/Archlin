import { runMigrations } from '@archlin/db/migrations';
import { createLogger } from '@archlin/platform/server';
import { migrationSets } from '../../../archlin.config';
import { loadMigrateEnv } from './env';

// One-shot process and the only one that holds the migrator credential. Exits 0 on success, 1 on failure.
try {
  const env = loadMigrateEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, service: 'migrate' });
  await runMigrations({ connectionString: env.MIGRATOR_DATABASE_URL, sets: migrationSets(), logger });
} catch (err) {
  createLogger({ level: 'error', service: 'migrate' }).error({ err }, 'migration run failed');
  process.exitCode = 1;
}
