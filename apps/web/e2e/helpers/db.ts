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

export async function viewCount(entityId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ view_count: number }>('select view_count from public.entities where id = $1', [entityId]);
    return result.rows[0]?.view_count ?? 0;
  });
}

// Copies of the version a save lost, written before either side of a conflict is dropped.
export async function conflictCopies(entityId: string): Promise<{ title: string; contentText: string }[]> {
  return withClient(async (client) => {
    const result = await client.query<{ title: string; content_text: string }>(
      `select title, content_text from public.kb_page_versions where entity_id = $1 and reason = 'conflict' order by created_at`,
      [entityId],
    );
    return result.rows.map((row) => ({ title: row.title, contentText: row.content_text }));
  });
}

// The E2E server runs no worker, so a spec sets the outcome the worker would have written.
export async function setAttachmentExtraction(
  entityId: string,
  status: 'done' | 'no_text' | 'failed',
  error?: 'timeout' | 'crashed' | 'corrupt' | 'archive_limits' | 'blob_missing',
): Promise<void> {
  await withClient(async (client) => {
    const result = await client.query(
      `update public.kb_attachments
          set extraction_status = $2, extraction_error = $3, extraction_lease_until = null
        where entity_id = $1`,
      [entityId, status, status === 'failed' ? (error ?? 'timeout') : null],
    );
    if (result.rowCount !== 1) throw new Error(`no attachment ${entityId}`);
  });
}

export async function attachmentIdsOf(pageId: string): Promise<string[]> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `select id from public.entities where parent_id = $1 and kind = 'kb.attachment' order by created_at`,
      [pageId],
    );
    return result.rows.map((row) => row.id);
  });
}

export async function versionReasons(entityId: string): Promise<string[]> {
  return withClient(async (client) => {
    const result = await client.query<{ reason: string }>(
      'select reason from public.kb_page_versions where entity_id = $1 order by created_at desc, id desc',
      [entityId],
    );
    return result.rows.map((row) => row.reason);
  });
}

export async function pageVersion(entityId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ version: number }>('select version from public.kb_pages where entity_id = $1', [entityId]);
    const row = result.rows[0];
    if (row === undefined) throw new Error(`no kb page for entity ${entityId}`);
    return row.version;
  });
}
