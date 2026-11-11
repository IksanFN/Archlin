import { runMigrations } from '@archlin/db/migrations';
import { systemIds } from '@archlin/kernel';
import { platformMigrations } from '@archlin/platform/migrations';
import pg from 'pg';
import { noopLogger } from '../fakes';
import { createScratchDatabase } from './scratch-database';
import type { TestDbUrls } from './urls';

export const OWNER_A_EMAIL = 'a@x.id';
export const OWNER_B_EMAIL = 'b@x.id';

// Scratch database with the platform migrations applied and two accounts (owner A and owner B).
export async function createTwoOwnerDatabase(): Promise<{ urls: TestDbUrls; ownerA: string; ownerB: string }> {
  const urls = await createScratchDatabase();
  await runMigrations({ connectionString: urls.migrator, sets: [platformMigrations], logger: noopLogger });

  const ownerA = systemIds.uuidv7();
  const ownerB = systemIds.uuidv7();
  const client = new pg.Client({ connectionString: urls.super });
  await client.connect();
  try {
    // The single-account index is product policy (spec 13.3); the isolation tests need two owners.
    await client.query('DROP INDEX public.users_single_account');
    for (const [id, email] of [
      [ownerA, OWNER_A_EMAIL],
      [ownerB, OWNER_B_EMAIL],
    ] as const) {
      await client.query(
        `SELECT public.auth_create_initial_account($1, $2, 'Test owner', 'not-a-real-hash', 'Asia/Jakarta', now())`,
        [id, email],
      );
    }
  } finally {
    await client.end();
  }
  return { urls, ownerA, ownerB };
}
