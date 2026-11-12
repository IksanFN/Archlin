import { runMigrations } from '@archlin/db/migrations';
import { platformMigrations } from '@archlin/platform/migrations';
import pg from 'pg';
import { noopLogger } from '../fakes';
import { createScratchDatabase } from './scratch-database';
import type { TestDbUrls } from './urls';

// Fresh database with only the platform migrations applied and no accounts, for auth flows that create their own.
export async function createPlatformDatabase(): Promise<TestDbUrls> {
  const urls = await createScratchDatabase();
  await runMigrations({ connectionString: urls.migrator, sets: [platformMigrations], logger: noopLogger });
  return urls;
}

// Runs as the migrator, which owns the tables and therefore bypasses row level security.
export async function resetIdentityData(urls: TestDbUrls): Promise<void> {
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    await client.query('truncate public.users, public.auth_attempts restart identity cascade');
  } finally {
    await client.end();
  }
}
