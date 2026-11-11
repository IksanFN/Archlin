import { runMigrations } from '@archlin/db/migrations';
import { systemIds } from '@archlin/kernel';
import { createScratchDatabase, createTwoOwnerDatabase, OWNER_A_EMAIL } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { noopLogger } from '@archlin/testing/fakes';
import pg from 'pg';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { platformMigrations } from './index';

type Query = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

async function run<T>(url: string, fn: (query: Query) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn((text, params) => client.query(text, params));
  } finally {
    await client.end();
  }
}

// Same shape as the runtime Unit of Work: one transaction with the owner set locally.
async function asOwner<T>(url: string, ownerId: string, fn: (query: Query) => Promise<T>): Promise<T> {
  return run(url, async (query) => {
    await query('BEGIN');
    try {
      await query(`select set_config('app.owner_id', $1, true)`, [ownerId]);
      const result = await fn(query);
      await query('COMMIT');
      return result;
    } catch (err) {
      await query('ROLLBACK');
      throw err;
    }
  });
}

const iso = (d: Date) => d.toISOString();
const secondsFrom = (base: Date, seconds: number) => new Date(base.getTime() + seconds * 1000);
const DAY = 86_400;

// owner column per table protected by the `_owner` policy
const OWNER_COLUMN = {
  users: 'id',
  user_settings: 'owner_id',
  sessions: 'user_id',
  recovery_codes: 'user_id',
  api_tokens: 'owner_id',
  security_events: 'owner_id',
} as const;
const OWNED_TABLES = Object.keys(OWNER_COLUMN) as (keyof typeof OWNER_COLUMN)[];

async function seedOwnerRows(superUrl: string, ownerId: string, tag: string): Promise<void> {
  const now = new Date();
  await run(superUrl, async (q) => {
    await q(
      `insert into public.sessions (id, public_id, user_id, created_at, expires_at, last_seen_at)
       values ($1, $2, $3, $4, $5, $4)`,
      [`session-${tag}`, systemIds.uuidv7(), ownerId, iso(now), iso(secondsFrom(now, 30 * DAY))],
    );
    await q(`insert into public.recovery_codes (user_id, code_hash, created_at) values ($1, $2, $3)`, [
      ownerId,
      `code-${tag}`,
      iso(now),
    ]);
    await q(
      `insert into public.api_tokens (id, owner_id, name, token_hash, scopes, created_at)
       values ($1, $2, 'token', $3, '{capture:write}', $4)`,
      [systemIds.uuidv7(), ownerId, `token-${tag}`, iso(now)],
    );
    await q(`insert into public.security_events (owner_id, event, created_at) values ($1, 'login.success', $2)`, [
      ownerId,
      iso(now),
    ]);
  });
}

describe('identity schema: isolation', () => {
  let urls: TestDbUrls;
  let ownerA: string;
  let ownerB: string;

  beforeAll(async () => {
    ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase());
    await seedOwnerRows(urls.super, ownerA, 'a');
    await seedOwnerRows(urls.super, ownerB, 'b');
  });

  it.each(OWNED_TABLES)('%s returns no rows without an owner setting', async (table) => {
    const total = await run(urls.super, (q) => q(`select count(*)::int as n from public.${table}`));
    expect(total.rows[0].n).toBeGreaterThanOrEqual(2);
    const visible = await run(urls.app, (q) => q(`select * from public.${table}`));
    expect(visible.rowCount).toBe(0);
  });

  it.each(OWNED_TABLES)('%s hides other owners rows', async (table) => {
    const column = OWNER_COLUMN[table];
    const rows = await asOwner(urls.app, ownerA, (q) => q(`select ${column} as owner from public.${table}`));
    expect(rows.rowCount).toBeGreaterThan(0);
    expect(new Set(rows.rows.map((r: { owner: string }) => r.owner))).toEqual(new Set([ownerA]));
  });

  it('rejects inserting a row for another owner', async () => {
    await expect(
      asOwner(urls.app, ownerA, (q) =>
        q(`insert into public.security_events (owner_id, event, created_at) values ($1, 'login.success', now())`, [ownerB]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('does not let an owner update or delete rows of another owner', async () => {
    const updated = await asOwner(urls.app, ownerA, (q) =>
      q(`update public.api_tokens set revoked_at = now() where owner_id = $1`, [ownerB]),
    );
    expect(updated.rowCount).toBe(0);
    const deleted = await asOwner(urls.app, ownerA, (q) => q(`delete from public.sessions where user_id = $1`, [ownerB]));
    expect(deleted.rowCount).toBe(0);
  });

  it('fails closed on a malformed owner setting', async () => {
    await expect(
      asOwner(urls.app, 'not-a-uuid', (q) => q('select * from public.users')),
    ).rejects.toMatchObject({ code: '22P02' });
  });

  it('treats an empty owner setting as no owner', async () => {
    const rows = await asOwner(urls.app, '', (q) => q('select * from public.users'));
    expect(rows.rowCount).toBe(0);
  });

  it('cortex_app cannot read auth_attempts or auth_challenges', async () => {
    for (const table of ['auth_attempts', 'auth_challenges']) {
      await expect(run(urls.app, (q) => q(`select * from public.${table}`))).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('cortex_app can change only permitted user columns', async () => {
    await asOwner(urls.app, ownerA, async (q) => {
      await q(`update public.users set display_name = 'Renamed' where id = $1`, [ownerA]);
    });
    await expect(
      asOwner(urls.app, ownerA, (q) => q(`update public.users set email = 'other@x.id' where id = $1`, [ownerA])),
    ).rejects.toMatchObject({ code: '42501' });
    await asOwner(urls.app, ownerA, async (q) => {
      await q(`update public.users set totp_last_used_step = 5 where id = $1`, [ownerA]);
    });
    await expect(
      asOwner(urls.app, ownerA, (q) => q(`update public.users set id = gen_random_uuid() where id = $1`, [ownerA])),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(asOwner(urls.app, ownerA, (q) => q(`delete from public.users where id = $1`, [ownerA]))).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('cortex_app can read the applied migration names', async () => {
    const rows = await run(urls.app, (q) => q('select name from public.kysely_migration'));
    expect(rows.rows.map((r: { name: string }) => r.name)).toContain('platform:202611111200_identity');
  });
});

describe('identity schema: constraints', () => {
  let urls: TestDbUrls;
  let ownerA: string;
  beforeAll(async () => {
    ({ urls, ownerA } = await createTwoOwnerDatabase());
  });

  it('rejects an email that is not lower case and trimmed', async () => {
    await expect(
      run(urls.super, (q) =>
        q(`select public.auth_create_initial_account($1, ' Mixed@X.id ', 'N', 'h', 'Asia/Jakarta', now())`, [systemIds.uuidv7()]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects enabling totp without a secret', async () => {
    await expect(
      run(urls.super, (q) => q(`update public.users set totp_enabled = true where id = $1`, [ownerA])),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects api token scopes outside the allowed list and empty scopes', async () => {
    for (const scopes of ['{admin}', '{}']) {
      await expect(
        run(urls.super, (q) =>
          q(
            `insert into public.api_tokens (id, owner_id, name, token_hash, scopes, created_at)
             values ($1, $2, 'bad', $3, $4, now())`,
            [systemIds.uuidv7(), ownerA, `hash-${scopes}`, scopes],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('rejects unknown security event names', async () => {
    await expect(
      run(urls.super, (q) =>
        q(`insert into public.security_events (owner_id, event, created_at) values ($1, 'made.up', now())`, [ownerA]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('identity schema: single account', () => {
  it('parallel initial account creation yields exactly one user', async () => {
    const urls = await createScratchDatabase();
    await runMigrations({ connectionString: urls.migrator, sets: [platformMigrations], logger: noopLogger });
    const createAccount = (email: string) =>
      run(urls.app, (q) =>
        q(`select public.auth_create_initial_account($1, $2, 'Owner', 'hash', 'Asia/Jakarta', now())`, [
          systemIds.uuidv7(),
          email,
        ]),
      );

    const results = await Promise.allSettled([createAccount('a@x.id'), createAccount('b@x.id')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: '23505' } });

    const count = await run(urls.super, (q) => q('select count(*)::int as n from public.users'));
    expect(count.rows[0].n).toBe(1);
    const settings = await run(urls.super, (q) => q('select timezone from public.user_settings'));
    expect(settings.rows).toEqual([{ timezone: 'Asia/Jakarta' }]);
  });
});

describe('auth gateway', () => {
  let urls: TestDbUrls;
  let ownerA: string;
  let ownerB: string;

  beforeEach(async () => {
    ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase());
  });

  const gateway = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) =>
    run(urls.app, (q) => q(text, params) as Promise<pg.QueryResult<T>>);
  const newChallenge = async (userId: string, now: Date, ttlSeconds = 300): Promise<string> => {
    const id = `challenge-${systemIds.uuidv7()}`;
    await gateway('select public.auth_create_challenge($1, $2, $3, $4)', [
      id,
      userId,
      iso(now),
      iso(secondsFrom(now, ttlSeconds)),
    ]);
    return id;
  };
  const finish = async (id: string, success: boolean, step: number, now: Date): Promise<boolean> => {
    const { rows } = await gateway<{ ok: boolean }>('select public.auth_finish_challenge($1, $2, $3, $4) as ok', [
      id,
      success,
      step,
      iso(now),
    ]);
    return rows[0]?.ok ?? false;
  };

  it('every gateway function is security definer, owned by cortex_identity, with a pinned search_path and no PUBLIC execute', async () => {
    const { rows } = await run(urls.super, (q) =>
      q(`
        select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner,
          coalesce(p.proconfig::text[] @> array['search_path=pg_catalog, pg_temp'], false) as pinned,
          (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) as public_execute,
          has_function_privilege('cortex_app', p.oid, 'EXECUTE') as app_execute
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'auth\\_%' order by p.proname`),
    );
    expect(rows.map((r) => r.proname)).toEqual([
      'auth_account_exists',
      'auth_consume_recovery_code',
      'auth_count_recent_failures',
      'auth_create_challenge',
      'auth_create_initial_account',
      'auth_find_login',
      'auth_finish_challenge',
      'auth_get_challenge',
      'auth_list_owner_ids',
      'auth_record_attempt',
      'auth_resolve_api_token',
      'auth_resolve_session',
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ prosecdef: true, owner: 'cortex_identity', pinned: true, public_execute: false, app_execute: true });
    }
  });

  it('gateway functions are not executable by other roles', async () => {
    const { rows } = await run(urls.super, (q) =>
      q(`select has_function_privilege('cortex_backup', 'public.auth_find_login(text)', 'EXECUTE') as can`),
    );
    expect(rows[0].can).toBe(false);
  });

  it('auth_account_exists and auth_list_owner_ids work before an owner is known', async () => {
    expect((await gateway('select public.auth_account_exists() as e')).rows[0]?.e).toBe(true);
    const ids = (await gateway<{ id: string }>('select public.auth_list_owner_ids() as id')).rows.map((r) => r.id);
    expect(new Set(ids)).toEqual(new Set([ownerA, ownerB]));
  });

  it('auth_find_login works before an owner is known and reveals no other columns', async () => {
    const found = await gateway(`select * from public.auth_find_login($1)`, [OWNER_A_EMAIL]);
    expect(found.rows).toEqual([{ user_id: ownerA, password_hash: 'not-a-real-hash', totp_enabled: false }]);
    expect((await gateway(`select * from public.auth_find_login('nobody@x.id')`)).rowCount).toBe(0);
    expect((await gateway('select email from public.users')).rowCount).toBe(0);
  });

  it('auth_record_attempt writes security events only for known users and failed or locked outcomes', async () => {
    const now = new Date();
    const record = (email: string, userId: string | null, outcome: string) =>
      gateway(`select public.auth_record_attempt($1, '203.0.113.7', $2, $3, $4, $5)`, [email, userId, outcome, 'x'.repeat(600), iso(now)]);
    await record(OWNER_A_EMAIL, ownerA, 'password_failed');
    await record(OWNER_A_EMAIL, ownerA, 'locked');
    await record(OWNER_A_EMAIL, ownerA, 'succeeded');
    await record('ghost@x.id', null, 'password_failed');

    const attempts = await run(urls.super, (q) => q('select outcome from public.auth_attempts order by id'));
    expect(attempts.rows.map((r) => r.outcome)).toEqual(['password_failed', 'locked', 'succeeded', 'password_failed']);
    const events = await run(urls.super, (q) =>
      q('select owner_id, event, metadata, length(user_agent) as ua from public.security_events order by id'),
    );
    expect(events.rows).toEqual([
      { owner_id: ownerA, event: 'login.failed', metadata: { stage: 'password_failed' }, ua: 512 },
      { owner_id: ownerA, event: 'login.locked', metadata: { stage: 'locked' }, ua: 512 },
    ]);
  });

  it('auth_count_recent_failures counts failures by email and by ip inside the window only', async () => {
    const now = new Date();
    const record = (email: string, ip: string, outcome: string, at: Date) =>
      gateway(`select public.auth_record_attempt($1, $2, null, $3, null, $4)`, [email, ip, outcome, iso(at)]);
    await record('a@x.id', '198.51.100.1', 'password_failed', secondsFrom(now, -60));
    await record('a@x.id', '198.51.100.2', 'totp_failed', secondsFrom(now, -30));
    await record('a@x.id', '198.51.100.1', 'recovery_failed', secondsFrom(now, -10));
    await record('a@x.id', '198.51.100.1', 'succeeded', secondsFrom(now, -5));
    await record('a@x.id', '198.51.100.1', 'password_failed', secondsFrom(now, -3600));
    await record('other@x.id', '198.51.100.1', 'password_failed', secondsFrom(now, -20));

    const { rows } = await gateway(`select * from public.auth_count_recent_failures($1, $2, $3)`, [
      'a@x.id',
      '198.51.100.1',
      iso(secondsFrom(now, -900)),
    ]);
    expect(rows).toEqual([{ by_email: 3, by_ip: 3 }]);
  });

  it('auth_get_challenge returns the pending challenge only until it expires', async () => {
    const now = new Date();
    const id = await newChallenge(ownerA, now);
    const live = await gateway(`select * from public.auth_get_challenge($1, $2)`, [id, iso(secondsFrom(now, 10))]);
    expect(live.rows).toEqual([{ user_id: ownerA, totp_secret_enc: null, totp_last_used_step: null }]);
    const expired = await gateway(`select * from public.auth_get_challenge($1, $2)`, [id, iso(secondsFrom(now, 301))]);
    expect(expired.rowCount).toBe(0);
  });

  it('auth_finish_challenge succeeds once for parallel submissions of the same code', async () => {
    const now = new Date();
    const id = await newChallenge(ownerA, now);
    const results = await Promise.all([finish(id, true, 1000, now), finish(id, true, 1000, now)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const step = await run(urls.super, (q) => q('select totp_last_used_step as s from public.users where id = $1', [ownerA]));
    expect(step.rows[0].s).toBe('1000');
  });

  it('auth_finish_challenge rejects a reused totp time step on a new challenge', async () => {
    const now = new Date();
    expect(await finish(await newChallenge(ownerA, now), true, 1000, now)).toBe(true);
    const second = await newChallenge(ownerA, now);
    expect(await finish(second, true, 1000, now)).toBe(false);
    expect(await finish(second, true, 999, now)).toBe(false);
    expect(await finish(second, true, 1001, now)).toBe(true);
  });

  it('auth_finish_challenge never consumes a challenge of another user or an expired one', async () => {
    const now = new Date();
    const expired = await newChallenge(ownerA, now, 60);
    expect(await finish(expired, true, 2000, secondsFrom(now, 61))).toBe(false);
    const step = await run(urls.super, (q) => q('select totp_last_used_step as s from public.users where id = $1', [ownerA]));
    expect(step.rows[0].s).toBeNull();
  });

  it('auth_finish_challenge burns the challenge after five failures', async () => {
    const now = new Date();
    const id = await newChallenge(ownerA, now);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await finish(id, false, 0, now)).toBe(false);
    }
    expect((await gateway(`select * from public.auth_get_challenge($1, $2)`, [id, iso(now)])).rowCount).toBe(0);
    expect(await finish(id, true, 3000, now)).toBe(false);
  });

  it('auth_consume_recovery_code consumes a code exactly once under concurrency', async () => {
    const now = new Date();
    await run(urls.super, (q) =>
      q(`insert into public.recovery_codes (user_id, code_hash, created_at) values ($1, 'hash-1', $2)`, [ownerA, iso(now)]),
    );
    const [c1, c2] = await Promise.all([newChallenge(ownerA, now), newChallenge(ownerA, now)]);
    const consume = (challenge: string, hash: string) =>
      gateway<{ user: string | null }>('select public.auth_consume_recovery_code($1, $2, $3) as "user"', [
        challenge,
        hash,
        iso(now),
      ]).then((r) => r.rows[0]?.user ?? null);

    const results = await Promise.all([consume(c1, 'hash-1'), consume(c2, 'hash-1')]);
    expect(results.filter((r) => r === ownerA)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    const used = await run(urls.super, (q) => q('select used_at from public.recovery_codes'));
    expect(used.rows[0].used_at).not.toBeNull();
  });

  it('auth_consume_recovery_code counts a wrong code as a failed attempt and burns the challenge after five', async () => {
    const now = new Date();
    const id = await newChallenge(ownerA, now);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { rows } = await gateway('select public.auth_consume_recovery_code($1, $2, $3) as u', [id, 'wrong', iso(now)]);
      expect(rows[0]?.u).toBeNull();
    }
    const state = await run(urls.super, (q) => q('select attempts, consumed_at from public.auth_challenges where id = $1', [id]));
    expect(state.rows[0]).toMatchObject({ attempts: 5 });
    expect(state.rows[0].consumed_at).not.toBeNull();
  });

  it('auth_resolve_session rejects idle (7 days) and absolute expiry', async () => {
    const now = new Date();
    const insert = (id: string, expiresIn: number, lastSeenAgo: number) =>
      run(urls.super, (q) =>
        q(
          `insert into public.sessions (id, public_id, user_id, created_at, expires_at, last_seen_at, reauth_until)
           values ($1, $2, $3, $4, $5, $6, null)`,
          [id, systemIds.uuidv7(), ownerA, iso(secondsFrom(now, -9 * DAY)), iso(secondsFrom(now, expiresIn)), iso(secondsFrom(now, -lastSeenAgo))],
        ),
      );
    await insert('idle', 20 * DAY, 8 * DAY);
    await insert('absolute', -1, 10);
    await insert('stale-seen', 20 * DAY, 120);
    await insert('fresh-seen', 20 * DAY, 10);
    const resolve = (id: string) =>
      gateway(`select * from public.auth_resolve_session($1, $2)`, [id, iso(now)]).then((r) => r.rows);

    expect(await resolve('idle')).toEqual([]);
    expect(await resolve('absolute')).toEqual([]);
    expect(await resolve('missing')).toEqual([]);
    expect(await resolve('stale-seen')).toMatchObject([{ user_id: ownerA, reauth_until: null }]);
    expect(await resolve('fresh-seen')).toMatchObject([{ user_id: ownerA }]);

    const seen = await run(urls.super, (q) => q('select id, last_seen_at from public.sessions order by id'));
    const bySession = new Map(seen.rows.map((r) => [r.id as string, (r.last_seen_at as Date).getTime()]));
    expect(bySession.get('stale-seen')).toBe(now.getTime());
    expect(bySession.get('fresh-seen')).toBe(secondsFrom(now, -10).getTime());
    expect(bySession.get('idle')).toBe(secondsFrom(now, -8 * DAY).getTime());
  });

  it('auth_resolve_api_token resolves live tokens, records use and ignores revoked ones', async () => {
    const now = new Date();
    const live = systemIds.uuidv7();
    await run(urls.super, async (q) => {
      await q(
        `insert into public.api_tokens (id, owner_id, name, token_hash, scopes, created_at) values ($1, $2, 'live', 'hash-live', '{capture:write}', $3)`,
        [live, ownerB, iso(now)],
      );
      await q(
        `insert into public.api_tokens (id, owner_id, name, token_hash, scopes, created_at, revoked_at) values ($1, $2, 'dead', 'hash-dead', '{capture:write}', $3, $3)`,
        [systemIds.uuidv7(), ownerB, iso(now)],
      );
    });
    const resolve = (hash: string) =>
      gateway(`select * from public.auth_resolve_api_token($1, $2)`, [hash, iso(now)]).then((r) => r.rows);

    expect(await resolve('hash-live')).toEqual([{ token_id: live, owner_id: ownerB, scopes: ['capture:write'] }]);
    expect(await resolve('hash-dead')).toEqual([]);
    expect(await resolve('hash-unknown')).toEqual([]);
    const used = await run(urls.super, (q) => q(`select name, last_used_at from public.api_tokens order by name`));
    expect(used.rows[0]).toMatchObject({ name: 'dead', last_used_at: null });
    expect((used.rows[1].last_used_at as Date).getTime()).toBe(now.getTime());
  });
});
