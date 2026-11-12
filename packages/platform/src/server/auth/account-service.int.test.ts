import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { createAuthHarness, TEST_META, VALID_SETUP } from '@archlin/testing/auth';
import type { AuthHarness } from '@archlin/testing/auth';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAccountService } from './account-service';
import type { AuthContext, IssuedSession } from './sessions';

let h: AuthHarness;
let session: IssuedSession;
let ctx: AuthContext;

const MINUTE = 60_000;
const credentials = { email: VALID_SETUP.email, password: VALID_SETUP.password };
const NEW_PASSWORD = 'kata-sandi-baru-456';

beforeAll(async () => {
  h = await createAuthHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  session = await h.auth.setup(VALID_SETUP, TEST_META);
  ctx = await h.auth.authenticate(session.token);
});

const reauth = async (): Promise<AuthContext> => {
  await h.account.reauthenticate(ctx, { password: VALID_SETUP.password }, TEST_META);
  return h.auth.authenticate(session.token);
};

const secondSession = async (): Promise<IssuedSession> => {
  const result = await h.auth.login(credentials, TEST_META);
  if (result.status !== 'authenticated') throw new Error('expected a session');
  return result.session;
};

describe('re-authentication', () => {
  const actions = {
    changePassword: (c: AuthContext) => h.account.changePassword(c, { newPassword: NEW_PASSWORD }, TEST_META),
    disableTotp: (c: AuthContext) => h.account.disableTotp(c, TEST_META),
    regenerateRecoveryCodes: (c: AuthContext) => h.account.regenerateRecoveryCodes(c, TEST_META),
  } as const;

  it.each(Object.keys(actions) as (keyof typeof actions)[])('%s requires recent reauthentication', async (action) => {
    await expect(actions[action](ctx)).rejects.toMatchObject({ code: 'reauth_required' });
  });

  it('accepts a sensitive change just inside the ten minute window', async () => {
    await reauth();
    h.clock.advance(10 * MINUTE - 1);
    const stillFresh = await h.auth.authenticate(session.token);
    expect(stillFresh.reauthUntil).not.toBeNull();
    await expect(actions.changePassword(stillFresh)).resolves.toBeDefined();
  });

  it('reauthentication expires after ten minutes', async () => {
    await reauth();
    h.clock.advance(10 * MINUTE);
    const expired = await h.auth.authenticate(session.token);
    await expect(actions.changePassword(expired)).rejects.toMatchObject({ code: 'reauth_required' });
  });

  it('rejects a wrong password and counts it toward the login limit', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(h.account.reauthenticate(ctx, { password: 'salah-salah-salah' }, TEST_META)).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
    }
    await expect(h.account.reauthenticate(ctx, { password: VALID_SETUP.password }, TEST_META)).rejects.toMatchObject({
      code: 'too_many_attempts',
    });
  });

  it('asks for a totp code when totp is enabled and spends its time step once', async () => {
    const totp = await h.enrollTotp(session);
    const totpSession = await h.auth.authenticate(totp.session.token);
    await expect(
      h.account.reauthenticate(totpSession, { password: VALID_SETUP.password }, TEST_META),
    ).rejects.toMatchObject({ details: { issues: [{ path: 'totpCode', message: 'required' }] } });

    h.clock.advance(30_000);
    const code = await totp.codeAt();
    await expect(
      h.account.reauthenticate(totpSession, { password: VALID_SETUP.password, totpCode: code }, TEST_META),
    ).resolves.toHaveProperty('reauthUntil');
    await expect(
      h.account.reauthenticate(totpSession, { password: VALID_SETUP.password, totpCode: code }, TEST_META),
    ).rejects.toMatchObject({ code: 'invalid_code' });
  });
});

describe('password change', () => {
  it('password change revokes other sessions and rotates the current one', async () => {
    const other = await secondSession();
    const fresh = await reauth();

    const rotated = await h.account.changePassword(fresh, { newPassword: NEW_PASSWORD }, TEST_META);

    await expect(h.auth.authenticate(session.token)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(h.auth.authenticate(other.token)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(h.auth.authenticate(rotated.token)).resolves.toBeDefined();
    await expect(h.auth.login({ ...credentials, password: NEW_PASSWORD }, TEST_META)).resolves.toMatchObject({
      status: 'authenticated',
    });
    await expect(h.auth.login(credentials, TEST_META)).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('rejects a new password that is too short and keeps the old one', async () => {
    const fresh = await reauth();
    await expect(h.account.changePassword(fresh, { newPassword: 'pendek' }, TEST_META)).rejects.toMatchObject({
      details: { issues: [{ path: 'password', message: 'password_too_short' }] },
    });
    await expect(h.auth.login(credentials, TEST_META)).resolves.toMatchObject({ status: 'authenticated' });
  });

  it('records password.changed', async () => {
    const fresh = await reauth();
    await h.account.changePassword(fresh, { newPassword: NEW_PASSWORD }, TEST_META);
    const events = await h.asMigrator(`select event from public.security_events where event = 'password.changed'`);
    expect(events.rows).toHaveLength(1);
  });
});

describe('totp enrollment', () => {
  it('enabling totp rotates the session and returns ten recovery codes once', async () => {
    const totp = await h.enrollTotp(session);
    expect(totp.recoveryCodes).toHaveLength(10);
    expect(new Set(totp.recoveryCodes).size).toBe(10);
    expect(totp.session.token).not.toBe(session.token);
    await expect(h.auth.authenticate(session.token)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(h.auth.authenticate(totp.session.token)).resolves.toBeDefined();
    const stored = await h.asMigrator('select code_hash from public.recovery_codes');
    expect(stored.rows).toHaveLength(10);
    expect(JSON.stringify(stored.rows)).not.toContain(totp.recoveryCodes[0]?.replaceAll('-', '') ?? 'unreachable');
  });

  it('stores the totp secret sealed, never in plain text', async () => {
    const totp = await h.enrollTotp(session);
    const rows = await h.asMigrator('select totp_secret_enc, totp_pending_secret_enc from public.users');
    expect(rows.rows[0]).toMatchObject({ totp_pending_secret_enc: null });
    expect((rows.rows[0] as { totp_secret_enc: string }).totp_secret_enc).not.toContain(totp.secret);
  });

  it('begin returns a secret and an otpauth uri labelled with the email', async () => {
    const begun = await h.account.beginTotpEnrollment(ctx);
    expect(begun.otpauthUri).toContain(begun.secret);
    expect(decodeURIComponent(begun.otpauthUri)).toContain(VALID_SETUP.email);
  });

  it('confirm without a pending enrollment is a conflict', async () => {
    await expect(h.account.confirmTotpEnrollment(ctx, { code: '123456' }, TEST_META)).rejects.toMatchObject({
      code: 'no_pending_enrollment',
    });
  });

  it('confirm with a wrong code keeps totp off', async () => {
    await h.account.beginTotpEnrollment(ctx);
    await expect(h.account.confirmTotpEnrollment(ctx, { code: '000000' }, TEST_META)).rejects.toMatchObject({
      code: 'invalid_code',
    });
    const viewer = await h.account.getViewer(ctx);
    expect(viewer.totpEnabled).toBe(false);
    await expect(h.auth.authenticate(session.token)).resolves.toBeDefined();
  });

  it('cannot begin enrollment while totp is already enabled', async () => {
    const totp = await h.enrollTotp(session);
    const enabledCtx = await h.auth.authenticate(totp.session.token);
    await expect(h.account.beginTotpEnrollment(enabledCtx)).rejects.toMatchObject({ code: 'totp_already_enabled' });
  });

  it('disabling totp rotates the session, clears the codes and returns login to a single step', async () => {
    const totp = await h.enrollTotp(session);
    h.clock.advance(30_000);
    await h.account.reauthenticate(
      await h.auth.authenticate(totp.session.token),
      { password: VALID_SETUP.password, totpCode: await totp.codeAt() },
      TEST_META,
    );
    const fresh = await h.auth.authenticate(totp.session.token);

    const rotated = await h.account.disableTotp(fresh, TEST_META);

    await expect(h.auth.authenticate(totp.session.token)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(h.auth.authenticate(rotated.token)).resolves.toBeDefined();
    const codes = await h.asMigrator('select count(*)::int as n from public.recovery_codes');
    expect(codes.rows[0]).toEqual({ n: 0 });
    await expect(h.auth.login(credentials, TEST_META)).resolves.toMatchObject({ status: 'authenticated' });
  });

  it('refuses to disable totp that is not enabled', async () => {
    const fresh = await reauth();
    await expect(h.account.disableTotp(fresh, TEST_META)).rejects.toMatchObject({ code: 'totp_not_enabled' });
    await expect(h.auth.authenticate(session.token)).resolves.toBeDefined();
  });

  it('regenerating recovery codes replaces the old ones', async () => {
    const totp = await h.enrollTotp(session);
    h.clock.advance(30_000);
    await h.account.reauthenticate(
      await h.auth.authenticate(totp.session.token),
      { password: VALID_SETUP.password, totpCode: await totp.codeAt() },
      TEST_META,
    );
    const fresh = await h.auth.authenticate(totp.session.token);

    const { recoveryCodes } = await h.account.regenerateRecoveryCodes(fresh, TEST_META);

    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes).not.toContain(totp.recoveryCodes[0]);
    await expect(h.auth.completeTotpLogin(await challengeFor(), { recoveryCode: totp.recoveryCodes[0] ?? '' }, TEST_META)).rejects.toMatchObject({
      code: 'invalid_code',
    });
    const events = await h.asMigrator(`select event from public.security_events where event = 'recovery_codes.regenerated'`);
    expect(events.rows).toHaveLength(1);
  });

  it('regenerating without totp is a conflict', async () => {
    const fresh = await reauth();
    await expect(h.account.regenerateRecoveryCodes(fresh, TEST_META)).rejects.toMatchObject({ code: 'totp_not_enabled' });
  });
});

async function challengeFor(): Promise<string> {
  const result = await h.auth.login(credentials, TEST_META);
  if (result.status !== 'totp_required') throw new Error('expected a totp challenge');
  return result.challenge.token;
}

describe('viewer and profile', () => {
  it('viewer exposes the remaining recovery code count, never the codes', async () => {
    const totp = await h.enrollTotp(session);
    const viewer = await h.account.getViewer(await h.auth.authenticate(totp.session.token));
    expect(viewer).toMatchObject({
      displayName: 'Andra',
      email: VALID_SETUP.email,
      timezone: 'Asia/Jakarta',
      totpEnabled: true,
      recoveryCodesRemaining: 10,
    });
    const serialized = JSON.stringify(viewer);
    for (const code of totp.recoveryCodes) expect(serialized).not.toContain(code);
    expect(serialized).not.toMatch(/hash|secret/i);
  });

  it('viewer reports when totp was enabled, and null before', async () => {
    expect((await h.account.getViewer(ctx)).totpEnabledAt).toBeNull();
    const totp = await h.enrollTotp(session);
    const viewer = await h.account.getViewer(await h.auth.authenticate(totp.session.token));
    expect(viewer.totpEnabledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('updateProfile changes the display name and timezone', async () => {
    const viewer = await h.account.updateProfile(ctx, { displayName: 'Andra S', timezone: 'Asia/Makassar' });
    expect(viewer).toMatchObject({ displayName: 'Andra S', timezone: 'Asia/Makassar' });
  });

  it('updateProfile rejects unknown timezone', async () => {
    await expect(h.account.updateProfile(ctx, { displayName: 'Andra', timezone: 'Mars/Olympus' })).rejects.toMatchObject({
      details: { issues: [{ path: 'timezone', message: 'unknown_timezone' }] },
    });
  });
});

describe('sessions', () => {
  it('lists active sessions and marks the current one', async () => {
    const other = await secondSession();
    const sessions = await h.account.listSessions(ctx);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions.find((s) => s.current)?.publicId).toBe(ctx.sessionPublicId);
    expect(JSON.stringify(sessions)).not.toContain(other.token);
  });

  it('does not list a session that has been idle for more than seven days', async () => {
    await secondSession();
    h.clock.advance(7 * 24 * 60 * MINUTE + 1000);
    const fresh = await h.auth.login(credentials, TEST_META);
    if (fresh.status !== 'authenticated') throw new Error('expected a session');
    const sessions = await h.account.listSessions(await h.auth.authenticate(fresh.session.token));
    expect(sessions).toHaveLength(1);
  });

  it('cannot revoke the current session through revokeSession', async () => {
    await expect(h.account.revokeSession(ctx, { publicId: ctx.sessionPublicId }, TEST_META)).rejects.toMatchObject({
      details: { issues: [{ path: 'publicId', message: 'cannot_revoke_current' }] },
    });
  });

  it('revoking another session logs that device out', async () => {
    const other = await secondSession();
    const otherCtx = await h.auth.authenticate(other.token);
    await h.account.revokeSession(ctx, { publicId: otherCtx.sessionPublicId }, TEST_META);
    await expect(h.auth.authenticate(other.token)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(h.auth.authenticate(session.token)).resolves.toBeDefined();
    const events = await h.asMigrator(`select event from public.security_events where event = 'session.revoked'`);
    expect(events.rows).toHaveLength(1);
  });

  it('revoking an unknown session is not found', async () => {
    await expect(
      h.account.revokeSession(ctx, { publicId: '00000000-0000-7000-8000-000000000001' }, TEST_META),
    ).rejects.toMatchObject({ code: 'session_not_found' });
  });

  it('revokeOtherSessions keeps the current session and logs one event with the count', async () => {
    const a = await secondSession();
    const b = await secondSession();
    await expect(h.account.revokeOtherSessions(ctx, TEST_META)).resolves.toEqual({ revoked: 2 });
    await expect(h.auth.authenticate(a.token)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(h.auth.authenticate(b.token)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(h.auth.authenticate(session.token)).resolves.toBeDefined();
    const events = await h.asMigrator(`select metadata from public.security_events where event = 'session.revoked'`);
    expect(events.rows).toEqual([{ metadata: { count: 2 } }]);
  });
});

describe('security events', () => {
  it('lists events newest first with only the summary fields', async () => {
    await secondSession();
    const events = await h.account.listSecurityEvents(ctx, { limit: 50 });
    expect(events.map((e) => e.event)).toEqual(['login.success', 'login.success']);
    expect(Object.keys(events[0] ?? {}).sort()).toEqual(['createdAt', 'event', 'ip', 'userAgent']);
    expect(events[0]?.ip).toBe(TEST_META.ip);
    const times = events.map((e) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('honours the limit', async () => {
    await secondSession();
    await secondSession();
    await expect(h.account.listSecurityEvents(ctx, { limit: 2 })).resolves.toHaveLength(2);
  });

  it('security events are newest first and scoped to the owner', async () => {
    const { urls, ownerA, ownerB } = await createTwoOwnerDatabase();
    const db = createDatabase({ connectionString: urls.app, applicationName: 'account-test-two-owners', max: 2 });
    try {
      const account = createAccountService({ ...h.deps, db, uow: createOwnerUnitOfWork(db) });
      const client = new pg.Client({ connectionString: urls.migrator });
      await client.connect();
      try {
        for (const [owner, event, at] of [
          [ownerA, 'login.success', '2026-11-11T01:00:00Z'],
          [ownerA, 'password.changed', '2026-11-11T02:00:00Z'],
          [ownerB, 'totp.enabled', '2026-11-11T03:00:00Z'],
        ] as const) {
          await client.query(`insert into public.security_events (owner_id, event, created_at) values ($1, $2, $3)`, [owner, event, at]);
        }
      } finally {
        await client.end();
      }
      const ctxA: AuthContext = { scope: issueOwnerScope(ownerA), sessionPublicId: ownerA, reauthUntil: null };
      const events = await account.listSecurityEvents(ctxA, { limit: 50 });
      expect(events.map((e) => e.event)).toEqual(['password.changed', 'login.success']);
    } finally {
      await db.destroy();
    }
  });
});
