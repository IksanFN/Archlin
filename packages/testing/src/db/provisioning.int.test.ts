import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';
import { createScratchDatabase } from './scratch-database';

async function query(url: string, text: string): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(text);
  } finally {
    await client.end();
  }
}

describe('postgres provisioning', () => {
  const urls = inject('testDb');
  const superQuery = (text: string) => query(urls.super, text);
  const appQuery = (text: string) => query(urls.app, text);

  it('cortex_app is not superuser, cannot bypass RLS and is not a member of privileged roles', async () => {
    const { rows } = await superQuery(`
      select rolsuper, rolbypassrls,
        pg_has_role('cortex_app', 'cortex_migrator', 'MEMBER') as in_migrator,
        pg_has_role('cortex_app', 'cortex_identity', 'MEMBER') as in_identity
      from pg_roles where rolname = 'cortex_app'`);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, in_migrator: false, in_identity: false });
  });

  it('cortex_identity cannot log in', async () => {
    const { rows } = await superQuery(`select rolcanlogin from pg_roles where rolname = 'cortex_identity'`);
    expect(rows).toEqual([{ rolcanlogin: false }]);
  });

  it('only cortex_backup bypasses RLS and it reads data through pg_read_all_data', async () => {
    const { rows } = await superQuery(`
      select rolname, rolbypassrls, rolsuper,
        pg_has_role(rolname, 'pg_read_all_data', 'MEMBER') as reads_all
      from pg_roles where rolname like 'cortex_%' order by rolname`);
    expect(rows).toEqual([
      { rolname: 'cortex_app', rolbypassrls: false, rolsuper: false, reads_all: false },
      { rolname: 'cortex_backup', rolbypassrls: true, rolsuper: false, reads_all: true },
      { rolname: 'cortex_identity', rolbypassrls: false, rolsuper: false, reads_all: false },
      { rolname: 'cortex_migrator', rolbypassrls: false, rolsuper: false, reads_all: false },
    ]);
  });

  it('required extensions exist in cortex_test', async () => {
    const { rows } = await superQuery(
      `select extname from pg_extension where extname in ('vector', 'pg_trgm', 'unaccent') order by extname`,
    );
    expect(rows.map((r: { extname: string }) => r.extname)).toEqual(['pg_trgm', 'unaccent', 'vector']);
  });

  it('cortex_app cannot create tables', async () => {
    await expect(appQuery('create table x (id int)')).rejects.toMatchObject({ code: '42501' });
  });

  it('PUBLIC has no create privilege on schema public', async () => {
    const { rows } = await superQuery(`select has_schema_privilege('public', 'public', 'CREATE') as can`);
    expect(rows[0]).toEqual({ can: false });
  });

  it('scratch databases are provisioned with the same privileges', async () => {
    const scratch = await createScratchDatabase();
    const { rows } = await query(
      scratch.super,
      `select current_database() as db,
         (select count(*)::int from pg_extension where extname in ('vector', 'pg_trgm', 'unaccent')) as extensions,
         has_schema_privilege('cortex_app', 'public', 'USAGE') as app_usage,
         has_schema_privilege('cortex_app', 'public', 'CREATE') as app_create`,
    );
    expect(rows[0]).toMatchObject({ extensions: 3, app_usage: true, app_create: false });
    expect(rows[0].db).toMatch(/^t_[0-9a-f]{8}$/);
    await expect(query(scratch.app, 'create table x (id int)')).rejects.toMatchObject({ code: '42501' });
  });
});
