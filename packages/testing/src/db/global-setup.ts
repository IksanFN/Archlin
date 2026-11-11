import { runMigrations } from '@archlin/db/migrations';
import { platformMigrations } from '@archlin/platform/migrations';
import { createLogger } from '@archlin/platform/server';
import type { TestProject } from 'vitest/node';
import { startTestPostgres } from './test-postgres';
import './urls';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const postgres = await startTestPostgres();
  await postgres.createDatabase('cortex_test');
  const urls = postgres.urls('cortex_test');
  // The fixture module's migrations join this list in Task 10.
  await runMigrations({
    connectionString: urls.migrator,
    sets: [platformMigrations],
    logger: createLogger({ level: 'warn', service: 'test' }),
  });
  project.provide('testDb', urls);
  project.provide('testDbServer', { host: postgres.host, port: postgres.port, containerId: postgres.containerId });
  return () => postgres.stop();
}
