import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

export interface CreateDatabaseOptions {
  readonly connectionString: string;
  readonly applicationName: string;
  readonly max?: number;
  // Called when an idle pooled connection fails (for example a database restart). pg drops that connection and the
  // next query opens a new one, but an unhandled pool 'error' event would terminate the process.
  readonly onPoolError?: (err: Error) => void;
}

export function createDatabase({
  connectionString,
  applicationName,
  max = 10,
  onPoolError,
}: CreateDatabaseOptions): Kysely<unknown> {
  const pool = new pg.Pool({ connectionString, application_name: applicationName, max });
  pool.on('error', (err) => onPoolError?.(err));
  return new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
}
