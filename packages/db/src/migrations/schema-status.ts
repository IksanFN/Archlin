import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export type SchemaStatus =
  | { status: 'ok' }
  | { status: 'pending'; missing: readonly string[] }
  | { status: 'unknown_migrations'; unknown: readonly string[] };

const UNDEFINED_TABLE = '42P01';

const isUndefinedTable = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === UNDEFINED_TABLE;

// Names recorded by the migration runner, or null when the migration table does not exist yet.
export async function readRecordedMigrations(db: Kysely<unknown>): Promise<string[] | null> {
  try {
    const { rows } = await sql<{ name: string }>`select name from kysely_migration`.execute(db);
    return rows.map((row) => row.name);
  } catch (err) {
    if (isUndefinedTable(err)) return null;
    throw err;
  }
}

// Compares the migrations recorded in the database with the ones this build knows about.
// `unknown_migrations` wins over `pending`: a schema newer than the build must never be served by it.
export async function readSchemaStatus(db: Kysely<unknown>, expected: readonly string[]): Promise<SchemaStatus> {
  const recorded = await readRecordedMigrations(db);
  if (recorded === null) return { status: 'pending', missing: expected };

  const known = new Set(expected);
  const unknown = recorded.filter((name) => !known.has(name)).sort();
  if (unknown.length > 0) return { status: 'unknown_migrations', unknown };

  const done = new Set(recorded);
  const missing = expected.filter((name) => !done.has(name));
  return missing.length > 0 ? { status: 'pending', missing } : { status: 'ok' };
}
