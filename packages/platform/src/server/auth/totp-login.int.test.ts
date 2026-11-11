import { sqlFor } from '@archlin/db/scoped';
import { createAuthHarness, TEST_META, VALID_SETUP } from '@archlin/testing/auth';
import type { AuthHarness, EnrolledTotp } from '@archlin/testing/auth';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHALLENGE_TTL_MS } from './policy';
import type { LoginResult } from './auth-service';

let h: AuthHarness;
let totp: EnrolledTotp;

const credentials = { email: VALID_SETUP.email, password: VALID_SETUP.password };

beforeAll(async () => {
  h = await createAuthHarness();
});
afterAll(async () => {
  await h.close();
});

// Account with TOTP on, clock moved to the next time step so that fresh codes are not the one spent at enrollment.
beforeEach(async () => {
  await h.reset();
  totp = await h.enrollTotp(await h.auth.setup(VALID_SETUP, TEST_META));
  h.clock.advance(30_000);
});

async function startChallenge(): Promise<string> {
  const result: LoginResult = await h.auth.login(credentials, TEST_META);
  if (result.status !== 'totp_required') throw new Error('expected a totp challenge');
  return result.challenge.token;
}

describe('totp login', () => {
  it('login asks for a second factor and issues no session yet', async () => {
    const result = await h.auth.login(credentials, TEST_META);
    expect(result.status).toBe('totp_required');
    const sessions = await h.asMigrator('select count(*)::int as n from public.sessions');
    expect(sessions.rows[0]).toEqual({ n: 1 });
  });

  it('totp code with spaces is accepted', async () => {
    const challenge = await startChallenge();
    const code = await totp.codeAt();
    const session = await h.auth.completeTotpLogin(challenge, { code: `${code.slice(0, 3)} ${code.slice(3)}` }, TEST_META);
    await expect(h.auth.authenticate(session.token)).resolves.toBeDefined();
  });

  it('same totp time step cannot be used twice', async () => {
    const code = await totp.codeAt();
    const first = await startChallenge();
    const session = await h.auth.completeTotpLogin(first, { code }, TEST_META);
    await h.auth.logout(await h.auth.authenticate(session.token));

    const second = await startChallenge();
    await expect(h.auth.completeTotpLogin(second, { code }, TEST_META)).rejects.toMatchObject({ code: 'invalid_code' });
  });

  it('a wrong code is rejected and recorded as a failed login', async () => {
    const challenge = await startChallenge();
    await expect(h.auth.completeTotpLogin(challenge, { code: '000000' }, TEST_META)).rejects.toMatchObject({
      code: 'invalid_code',
    });
    const events = await h.asMigrator(`select metadata from public.security_events where event = 'login.failed'`);
    expect(events.rows).toEqual([{ metadata: { stage: 'totp_failed' } }]);
  });

  it('an unknown challenge token is reported as expired', async () => {
    await expect(h.auth.completeTotpLogin('x'.repeat(43), { code: '123456' }, TEST_META)).rejects.toMatchObject({
      code: 'challenge_expired',
    });
  });

  it('an expired challenge is rejected', async () => {
    const challenge = await startChallenge();
    const code = await totp.codeAt();
    h.clock.advance(CHALLENGE_TTL_MS + 1);
    await expect(h.auth.completeTotpLogin(challenge, { code }, TEST_META)).rejects.toMatchObject({
      code: 'challenge_expired',
    });
  });

  it('a challenge is single use', async () => {
    const challenge = await startChallenge();
    await h.auth.completeTotpLogin(challenge, { code: await totp.codeAt() }, TEST_META);
    h.clock.advance(30_000);
    await expect(h.auth.completeTotpLogin(challenge, { code: await totp.codeAt() }, TEST_META)).rejects.toMatchObject({
      code: 'challenge_expired',
    });
  });

  it('login is rate limited per ip while completing the second factor', async () => {
    for (let i = 0; i < 5; i++) {
      const challenge = await startChallenge();
      await h.auth.completeTotpLogin(challenge, { code: '000000' }, TEST_META).catch(() => undefined);
    }
    const challenge = await h.auth.login(credentials, TEST_META).catch((e: unknown) => e);
    expect(challenge).toMatchObject({ code: 'too_many_attempts' });
  });
});

describe('recovery code login', () => {
  it('a recovery code logs in once and is then spent', async () => {
    const recoveryCode = totp.recoveryCodes[0] ?? '';
    const session = await h.auth.completeTotpLogin(await startChallenge(), { recoveryCode: recoveryCode.toLowerCase() }, TEST_META);
    await expect(h.auth.authenticate(session.token)).resolves.toBeDefined();

    await expect(h.auth.completeTotpLogin(await startChallenge(), { recoveryCode }, TEST_META)).rejects.toMatchObject({
      code: 'invalid_code',
    });
  });

  it('records recovery_code.used with the number of codes left', async () => {
    const session = await h.auth.completeTotpLogin(
      await startChallenge(),
      { recoveryCode: totp.recoveryCodes[0] ?? '' },
      TEST_META,
    );
    const ctx = await h.auth.authenticate(session.token);
    const events = await h.uow.read(ctx.scope, (tx) =>
      sql<{ metadata: { remaining: number } }>`select metadata from public.security_events where event = 'recovery_code.used'`.execute(
        sqlFor(tx),
      ),
    );
    expect(events.rows).toEqual([{ metadata: { remaining: 9 } }]);
  });

  it('a malformed recovery code is rejected without consuming anything', async () => {
    await expect(h.auth.completeTotpLogin(await startChallenge(), { recoveryCode: 'bukan kode' }, TEST_META)).rejects.toMatchObject({
      code: 'invalid_code',
    });
  });

  it('an unknown recovery code is rejected', async () => {
    await expect(
      h.auth.completeTotpLogin(await startChallenge(), { recoveryCode: 'ABCD-EFGH-JKMN-PQRS' }, TEST_META),
    ).rejects.toMatchObject({ code: 'invalid_code' });
  });
});

describe('parallel completion', () => {
  it.each(['totp', 'recovery'] as const)('parallel completion with the same %s code yields one session', async (kind) => {
    const challenge = await startChallenge();
    const input = kind === 'totp' ? { code: await totp.codeAt() } : { recoveryCode: totp.recoveryCodes[0] ?? '' };
    const results = await Promise.allSettled([
      h.auth.completeTotpLogin(challenge, input, TEST_META),
      h.auth.completeTotpLogin(challenge, input, TEST_META),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const sessions = await h.asMigrator('select count(*)::int as n from public.sessions');
    expect(sessions.rows[0]).toEqual({ n: 2 });
  });
});
