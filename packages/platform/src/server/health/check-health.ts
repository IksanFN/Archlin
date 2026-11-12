import { readSchemaStatus } from '@archlin/db/migrations';
import type { Logger } from '@archlin/kernel';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export interface HealthReport {
  db: 'ok' | 'error';
  migrations: 'ok' | 'pending' | 'unknown_migrations' | 'error';
}

export interface CheckHealthDeps {
  db: Kysely<unknown>;
  expectedMigrations: readonly string[];
  timeoutMs?: number;
  logger?: Logger;
}

const DEFAULT_TIMEOUT_MS = 2000;

// A stalled connection must not hold a probe open: the race gives up, the abandoned query is left to the pool.
async function within<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`health probe exceeded ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// The report is deliberately coarse (spec 14.4): it is public, so it names states, never causes. Causes go to the log.
export async function checkHealth({
  db,
  expectedMigrations,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger,
}: CheckHealthDeps): Promise<HealthReport> {
  try {
    await within(sql`select 1`.execute(db), timeoutMs);
  } catch (err) {
    logger?.warn({ err }, 'health probe: database unreachable');
    return { db: 'error', migrations: 'error' };
  }

  try {
    const schema = await within(readSchemaStatus(db, expectedMigrations), timeoutMs);
    return { db: 'ok', migrations: schema.status };
  } catch (err) {
    logger?.warn({ err }, 'health probe: schema status unreadable');
    return { db: 'ok', migrations: 'error' };
  }
}
