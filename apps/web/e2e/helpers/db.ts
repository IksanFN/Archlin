import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { Client } from 'pg';

// Read from the file, not process.env: the web server inherits the runner environment, and it refuses to start with a
// migrator credential in it (spec 13.4 R04).
function migratorUrl(): string {
  const url = parseEnv(readFileSync('e2e/.env.e2e-runner', 'utf8')).MIGRATOR_DATABASE_URL;
  if (url === undefined) throw new Error('MIGRATOR_DATABASE_URL is missing from e2e/.env.e2e-runner');
  return url;
}

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: migratorUrl() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// Gives every spec a first-run install: no account, no sessions, no failed-login history.
export async function resetAccount(): Promise<void> {
  await withClient((client) => client.query('truncate public.users, public.auth_attempts restart identity cascade'));
}

export async function userCount(): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>('select count(*) from public.users');
    return Number(result.rows[0]?.count ?? 0);
  });
}
