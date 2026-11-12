import { sqlFor } from '@archlin/db/scoped';
import { createAuthHarness, SENTINEL, TEST_META, TEST_START, VALID_SETUP } from '@archlin/testing/auth';
import type { AuthHarness } from '@archlin/testing/auth';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from './policy';
import { generateToken, hashToken } from './tokens';

const DAY = 24 * 60 * 60_000;
const MINUTE = 60_000;

let h: AuthHarness;
let auth: AuthHarness['auth'];

beforeAll(async () => {
  h = await createAuthHarness();
  auth = h.auth;
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

const eventsOf = async (token: string): Promise<{ event: string; metadata: Record<string, unknown> }[]> => {
  const ctx = await auth.authenticate(token);
  const result = await h.uow.read(ctx.scope, (tx) =>
    sql<{ event: string; metadata: Record<string, unknown> }>`select event, metadata from public.security_events order by id`.execute(
      sqlFor(tx),
    ),
  );
  return result.rows;
};

describe('setup', () => {
  it('setup creates the account, settings and a session', async () => {
    const session = await auth.setup(VALID_SETUP, TEST_META);
    expect(session.token).toHaveLength(43);
    const ctx = await auth.authenticate(session.token);
    const tz = await h.uow.read(ctx.scope, (tx) =>
      sql<{ timezone: string }>`select timezone from user_settings`.execute(sqlFor(tx)),
    );
    expect(tz.rows[0]?.timezone).toBe('Asia/Jakarta');
  });

  it('stores only the hash of the session token', async () => {
    const session = await auth.setup(VALID_SETUP, TEST_META);
    const rows = await h.asMigrator('select id from public.sessions');
    expect(rows.rows).toEqual([{ id: hashToken(session.token) }]);
  });

  it('second setup is rejected as already_set_up', async () => {
    await auth.setup(VALID_SETUP, TEST_META);
    await expect(auth.setup({ ...VALID_SETUP, email: 'lain@archlin.id' }, TEST_META)).rejects.toMatchObject({
      code: 'already_set_up',
    });
  });

  it('parallel setup requests create one account', async () => {
    const results = await Promise.allSettled([
      auth.setup({ ...VALID_SETUP, email: 'satu@archlin.id' }, TEST_META),
      auth.setup({ ...VALID_SETUP, email: 'dua@archlin.id' }, TEST_META),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: 'already_set_up' });
    const users = await h.asMigrator('select count(*)::int as n from public.users');
    expect(users.rows[0]).toEqual({ n: 1 });
  });

  it('setup rejects a wrong setup token', async () => {
    await expect(auth.setup({ ...VALID_SETUP, setupToken: 'salah' }, TEST_META)).rejects.toMatchObject({
      code: 'invalid_setup_token',
    });
    const users = await h.asMigrator('select count(*)::int as n from public.users');
    expect(users.rows[0]).toEqual({ n: 0 });
  });

  it('setup is disabled when no setup token is configured', async () => {
    const disabled = h.makeAuth({ setupToken: null });
    await expect(disabled.setup(VALID_SETUP, TEST_META)).rejects.toMatchObject({ code: 'setup_not_configured' });
  });

  it('setup rejects unknown timezone', async () => {
    await expect(auth.setup({ ...VALID_SETUP, timezone: 'Mars/Olympus' }, TEST_META)).rejects.toMatchObject({
      details: { issues: [{ path: 'timezone', message: 'unknown_timezone' }] },
    });
  });

  it('setup rejects a password shorter than twelve characters', async () => {
    await expect(auth.setup({ ...VALID_SETUP, password: 'pendek' }, TEST_META)).rejects.toMatchObject({
      details: { issues: [{ path: 'password', message: 'password_too_short' }] },
    });
  });

  it('setup stores the email normalized', async () => {
    await auth.setup({ ...VALID_SETUP, email: '  Andra@Archlin.ID ' }, TEST_META);
    const users = await h.asMigrator('select email from public.users');
    expect(users.rows).toEqual([{ email: 'andra@archlin.id' }]);
  });
});

describe('login', () => {
  it('login normalizes email case and surrounding whitespace', async () => {
    await auth.setup({ ...VALID_SETUP, email: 'andra@archlin.id' }, TEST_META);
    await expect(
      auth.login({ email: '  Andra@Archlin.ID ', password: VALID_SETUP.password }, TEST_META),
    ).resolves.toMatchObject({ status: 'authenticated' });
  });

  it('login accepts the password in a different unicode normalization form', async () => {
    await auth.setup({ ...VALID_SETUP, password: 'kata-sandi-café-123' }, TEST_META);
    await expect(
      auth.login({ email: VALID_SETUP.email, password: 'kata-sandi-café-123' }, TEST_META),
    ).resolves.toMatchObject({ status: 'authenticated' });
  });

  it('unknown email and wrong password fail with the same code and message', async () => {
    await auth.setup(VALID_SETUP, TEST_META);
    const unknown = await auth.login({ email: 'tidak@ada.id', password: 'salah-salah-salah' }, TEST_META).catch((e: unknown) => e);
    const wrong = await auth.login({ email: VALID_SETUP.email, password: 'salah-salah-salah' }, TEST_META).catch((e: unknown) => e);
    expect(unknown).toMatchObject({ code: 'invalid_credentials' });
    expect(wrong).toMatchObject({ code: 'invalid_credentials' });
    expect((unknown as Error).message).toBe((wrong as Error).message);
  });

  it('sixth failure within fifteen minutes is rate limited per account', async () => {
    await auth.setup(VALID_SETUP, TEST_META);
    const email = VALID_SETUP.email;
    for (let i = 0; i < 5; i++) {
      await expect(auth.login({ email, password: 'salah-salah-salah' }, TEST_META)).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
    }
    await expect(auth.login({ email, password: VALID_SETUP.password }, TEST_META)).rejects.toMatchObject({
      code: 'too_many_attempts',
      details: { retryAfterSeconds: 900 },
    });
    h.clock.advance(15 * MINUTE + 1);
    await expect(auth.login({ email, password: VALID_SETUP.password }, TEST_META)).resolves.toMatchObject({
      status: 'authenticated',
    });
  });

  it('rate limit also applies per ip across emails', async () => {
    await auth.setup(VALID_SETUP, TEST_META);
    for (let i = 0; i < 5; i++) {
      await expect(
        auth.login({ email: `orang${i}@archlin.id`, password: 'salah-salah-salah' }, TEST_META),
      ).rejects.toMatchObject({ code: 'invalid_credentials' });
    }
    const credentials = { email: VALID_SETUP.email, password: VALID_SETUP.password };
    await expect(auth.login(credentials, TEST_META)).rejects.toMatchObject({ code: 'too_many_attempts' });
    await expect(auth.login(credentials, { ...TEST_META, ip: '198.51.100.9' })).resolves.toMatchObject({
      status: 'authenticated',
    });
  });

  it('delays failures progressively', async () => {
    await auth.setup(VALID_SETUP, TEST_META);
    for (let i = 0; i < 5; i++) {
      await auth.login({ email: VALID_SETUP.email, password: 'salah-salah-salah' }, TEST_META).catch(() => undefined);
    }
    expect(h.sleeps).toEqual([250, 500, 1000, 2000, 4000]);
  });

  it('does not delay a successful login', async () => {
    await auth.setup(VALID_SETUP, TEST_META);
    await auth.login({ email: VALID_SETUP.email, password: VALID_SETUP.password }, TEST_META);
    expect(h.sleeps).toEqual([]);
  });
});

describe('sessions', () => {
  it('authenticate rejects an unknown token', async () => {
    await expect(auth.authenticate('x'.repeat(43))).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a session idle for more than seven days', async () => {
    const session = await auth.setup(VALID_SETUP, TEST_META);
    h.clock.advance(SESSION_IDLE_MS + 1000);
    await expect(auth.authenticate(session.token)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('keeps a session that is used at least once a week', async () => {
    const session = await auth.setup(VALID_SETUP, TEST_META);
    for (let i = 0; i < 3; i++) {
      h.clock.advance(6 * DAY);
      await expect(auth.authenticate(session.token)).resolves.toBeDefined();
    }
  });

  it('rejects a session older than thirty days even when used daily', async () => {
    const session = await auth.setup(VALID_SETUP, TEST_META);
    for (let day = 1; day < 30; day++) {
      h.clock.advance(DAY);
      await expect(auth.authenticate(session.token)).resolves.toBeDefined();
    }
    h.clock.advance(DAY);
    expect(h.clock.now().getTime() - TEST_START.getTime()).toBe(SESSION_ABSOLUTE_MS);
    await expect(auth.authenticate(session.token)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('logout removes only the current session', async () => {
    const first = await auth.setup(VALID_SETUP, TEST_META);
    const second = await auth.login({ email: VALID_SETUP.email, password: VALID_SETUP.password }, TEST_META);
    if (second.status !== 'authenticated') throw new Error('expected a session');
    await auth.logout(await auth.authenticate(first.token));
    await expect(auth.authenticate(first.token)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(auth.authenticate(second.session.token)).resolves.toBeDefined();
  });

  it('truncates a long user agent to 512 characters without splitting a surrogate pair', async () => {
    const userAgent = `${'a'.repeat(511)}😀tail`;
    await auth.setup(VALID_SETUP, { ...TEST_META, userAgent });
    const rows = await h.asMigrator('select user_agent from public.sessions');
    const stored = (rows.rows[0] as { user_agent: string }).user_agent;
    expect([...stored]).toHaveLength(512);
    expect(stored.endsWith('😀')).toBe(true);
  });
});

describe('auth state', () => {
  it('reports setup availability, account existence and authentication', async () => {
    await expect(auth.getAuthState(null)).resolves.toEqual({ accountExists: false, setupConfigured: true, authenticated: false });
    await expect(h.makeAuth({ setupToken: null }).getAuthState(null)).resolves.toMatchObject({ setupConfigured: false });
    const session = await auth.setup(VALID_SETUP, TEST_META);
    await expect(auth.getAuthState(null)).resolves.toEqual({ accountExists: true, setupConfigured: true, authenticated: false });
    await expect(auth.getAuthState(session.token)).resolves.toMatchObject({ authenticated: true });
    await expect(auth.getAuthState('x'.repeat(43))).resolves.toMatchObject({ authenticated: false });
  });
});

describe('security events and logging', () => {
  it('records login.success and login.failed security events', async () => {
    const session = await auth.setup(VALID_SETUP, TEST_META);
    await auth.login({ email: VALID_SETUP.email, password: 'salah-salah-salah' }, TEST_META).catch(() => undefined);
    const events = await eventsOf(session.token);
    expect(events.map((e) => e.event)).toEqual(['login.success', 'login.failed']);
  });

  it('records login.locked once the limit is reached', async () => {
    const session = await auth.setup(VALID_SETUP, TEST_META);
    for (let i = 0; i < 5; i++) {
      await auth.login({ email: VALID_SETUP.email, password: 'salah-salah-salah' }, TEST_META).catch(() => undefined);
    }
    await auth.login({ email: VALID_SETUP.email, password: VALID_SETUP.password }, TEST_META).catch(() => undefined);
    const events = await eventsOf(session.token);
    expect(events.at(-1)?.event).toBe('login.locked');
  });

  it('auth flows never write credentials to logs', async () => {
    const password = `${SENTINEL}-password-123`;
    const session = await auth.setup({ ...VALID_SETUP, password }, TEST_META);
    await auth.login({ email: VALID_SETUP.email, password: `${SENTINEL}-salah` }, TEST_META).catch(() => undefined);
    await auth.login({ email: `${SENTINEL}@tidak.ada`, password }, TEST_META).catch(() => undefined);
    await auth.login({ email: VALID_SETUP.email, password }, TEST_META);
    expect(h.logs.lines().length).toBeGreaterThan(0);
    expect(h.logs.text()).not.toContain(SENTINEL);
    expect(h.logs.text()).not.toContain(session.token);
    expect(h.logs.text()).not.toContain(VALID_SETUP.setupToken);
  });
});

describe('api tokens', () => {
  const insertToken = async (revoked: boolean): Promise<{ token: string; tokenId: string; ownerId: string }> => {
    const session = await auth.setup(VALID_SETUP, TEST_META);
    const ctx = await auth.authenticate(session.token);
    const token = generateToken();
    const tokenId = '00000000-0000-7000-8000-0000000000aa';
    const revokedAt = revoked ? h.clock.now() : null;
    await h.uow.write(ctx.scope, (tx) =>
      sql`
        insert into public.api_tokens (id, owner_id, name, token_hash, scopes, revoked_at, created_at)
        values (${tokenId}::uuid, ${ctx.scope.ownerId}::uuid, 'ios shortcut', ${hashToken(token)}, array['capture:write'],
                ${revokedAt}, ${h.clock.now()})
      `.execute(sqlFor(tx)),
    );
    return { token, tokenId, ownerId: ctx.scope.ownerId };
  };

  it('resolves an active api token to its owner, id and scopes', async () => {
    const { token, tokenId, ownerId } = await insertToken(false);
    const resolved = await auth.authenticateApiToken(token);
    expect(resolved.owner.ownerId).toBe(ownerId);
    expect(resolved.tokenId).toBe(tokenId);
    expect(resolved.scopes).toEqual(['capture:write']);
  });

  it('rejects an unknown api token', async () => {
    await expect(auth.authenticateApiToken(generateToken())).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a revoked api token', async () => {
    const { token } = await insertToken(true);
    await expect(auth.authenticateApiToken(token)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
