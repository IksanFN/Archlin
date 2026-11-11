import { sqlFor } from '@archlin/db/scoped';
import {
  ConflictError,
  ForbiddenError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from '@archlin/kernel';
import type { Clock, Ids, Logger, OwnerUnitOfWork, WriteTx } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthState, LoginInput, SetupInput, TotpLoginInput } from '../../contracts';
import { createIdentityGateway } from './identity-gateway';
import { isSupportedTimezone, normalizeEmail } from './normalize';
import { normalizePassword, validateNewPassword } from './password';
import type { PasswordHasher } from './password';
import {
  CHALLENGE_TTL_MS,
  failureDelayMs,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
} from './policy';
import { hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes';
import { recordSecurityEvent } from './security-events';
import type { SecretBox } from './secret-box';
import { insertSession } from './sessions';
import type { AuthContext, IssuedSession, PendingChallenge, RequestMeta } from './sessions';
import { generateToken, hashToken } from './tokens';
import type { Totp } from './totp';

export type LoginResult =
  | { status: 'authenticated'; session: IssuedSession }
  | { status: 'totp_required'; challenge: PendingChallenge };

export interface AuthDeps {
  db: Kysely<unknown>;
  uow: OwnerUnitOfWork;
  clock: Clock;
  ids: Ids;
  hasher: PasswordHasher;
  totp: Totp;
  secretBox: SecretBox;
  logger: Logger;
  setupToken: string | null;
  sleep: (ms: number) => Promise<void>;
}

export interface AuthService {
  getAuthState(sessionToken: string | null): Promise<AuthState>;
  setup(input: SetupInput, meta: RequestMeta): Promise<IssuedSession>;
  login(input: LoginInput, meta: RequestMeta): Promise<LoginResult>;
  completeTotpLogin(challengeToken: string, input: TotpLoginInput, meta: RequestMeta): Promise<IssuedSession>;
  authenticate(sessionToken: string): Promise<AuthContext>;
  logout(ctx: AuthContext): Promise<void>;
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === UNIQUE_VIOLATION;
}

// Comparing digests keeps the comparison constant-time regardless of the length of what was submitted.
function sameSecret(expected: string, submitted: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(expected), digest(submitted));
}

export function createAuthService(deps: AuthDeps): AuthService {
  const { db, uow, clock, hasher, totp, secretBox, logger, setupToken, sleep } = deps;
  const gateway = createIdentityGateway(db);

  async function issueSession(
    userId: string,
    meta: RequestMeta,
    inTransaction?: (tx: WriteTx) => Promise<void>,
  ): Promise<IssuedSession> {
    const now = clock.now();
    return uow.write(issueOwnerScope(userId), async (tx) => {
      const session = await insertSession(tx, deps, meta);
      await recordSecurityEvent(tx, { event: 'login.success', meta, now, sessionPublicId: session.publicId });
      await inTransaction?.(tx);
      return { token: session.token, expiresAt: session.expiresAt };
    });
  }

  // Returns the failures already in the window so the caller can scale its delay; throws once the limit is reached.
  async function assertNotLocked(email: string | null, userId: string | null, meta: RequestMeta): Promise<number> {
    const now = clock.now();
    const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
    const { byEmail, byIp } = await gateway.countRecentFailures(email, meta.ip, since);
    if (byEmail >= LOGIN_MAX_FAILURES || byIp >= LOGIN_MAX_FAILURES) {
      await gateway.recordAttempt({ email, ip: meta.ip, userId, outcome: 'locked', userAgent: meta.userAgent, now });
      logger.warn({ outcome: 'locked', userIdPresent: userId !== null });
      throw new RateLimitedError('too_many_attempts', 'Terlalu banyak percobaan. Coba lagi nanti.', {
        retryAfterSeconds: LOGIN_WINDOW_MS / 1000,
      });
    }
    return Math.max(byEmail, byIp);
  }

  async function failLogin(email: string, userId: string | null, priorFailures: number, meta: RequestMeta): Promise<never> {
    await gateway.recordAttempt({
      email,
      ip: meta.ip,
      userId,
      outcome: 'password_failed',
      userAgent: meta.userAgent,
      now: clock.now(),
    });
    logger.info({ outcome: 'login_failed', userIdPresent: userId !== null });
    await sleep(failureDelayMs(priorFailures));
    // One code and message for unknown email and wrong password, so the response never reveals which accounts exist.
    throw new UnauthorizedError('invalid_credentials', 'Email atau password salah');
  }

  async function recordSecondFactorFailure(
    outcome: 'totp_failed' | 'recovery_failed',
    userId: string,
    meta: RequestMeta,
  ): Promise<never> {
    // The challenge row has no email, so these count toward the per-ip limit only.
    await gateway.recordAttempt({
      email: null,
      ip: meta.ip,
      userId,
      outcome,
      userAgent: meta.userAgent,
      now: clock.now(),
    });
    logger.info({ outcome, userIdPresent: true });
    throw new UnauthorizedError('invalid_code', 'Kode tidak valid');
  }

  async function verifyTotpCode(challengeId: string, code: string, meta: RequestMeta): Promise<string> {
    const now = clock.now();
    const challenge = await gateway.getChallenge(challengeId, now);
    if (!challenge?.totpSecretEnc) {
      throw new UnauthorizedError('challenge_expired', 'Sesi verifikasi berakhir. Masuk lagi.');
    }
    const verification = await totp.verify(
      secretBox.open(challenge.totpSecretEnc),
      code,
      now,
      challenge.totpLastUsedStep,
    );
    // The step guard also lives in SQL, so two parallel requests with the same code cannot both finish the challenge.
    const finished = await gateway.finishChallenge(
      challengeId,
      verification.valid,
      verification.valid ? verification.timeStep : null,
      now,
    );
    if (!verification.valid || !finished) {
      return recordSecondFactorFailure('totp_failed', challenge.userId, meta);
    }
    return challenge.userId;
  }

  async function verifyRecoveryCode(challengeId: string, input: string, meta: RequestMeta): Promise<string> {
    const normalized = normalizeRecoveryCode(input);
    if (normalized === null) throw new UnauthorizedError('invalid_code', 'Kode tidak valid');
    const userId = await gateway.consumeRecoveryCode(challengeId, hashRecoveryCode(normalized), clock.now());
    if (userId === null) {
      // The gateway returns no user for a spent code or a dead challenge, so there is no account to attribute this to.
      await gateway.recordAttempt({
        email: null,
        ip: meta.ip,
        userId: null,
        outcome: 'recovery_failed',
        userAgent: meta.userAgent,
        now: clock.now(),
      });
      logger.info({ outcome: 'recovery_failed', userIdPresent: false });
      throw new UnauthorizedError('invalid_code', 'Kode tidak valid');
    }
    return userId;
  }

  async function authenticate(sessionToken: string): Promise<AuthContext> {
    const record = await gateway.resolveSession(hashToken(sessionToken), clock.now());
    if (!record) throw new UnauthorizedError();
    return {
      scope: issueOwnerScope(record.userId),
      sessionPublicId: record.publicId,
      reauthUntil: record.reauthUntil,
    };
  }

  return {
    async getAuthState(sessionToken) {
      let authenticated = false;
      if (sessionToken !== null) {
        try {
          await authenticate(sessionToken);
          authenticated = true;
        } catch (err) {
          if (!(err instanceof UnauthorizedError)) throw err;
        }
      }
      return { accountExists: await gateway.accountExists(), setupConfigured: setupToken !== null, authenticated };
    },

    async setup(input, meta) {
      if (setupToken === null) {
        throw new ForbiddenError('setup_not_configured', 'Setup belum dikonfigurasi di server');
      }
      if (!sameSecret(setupToken, input.setupToken)) {
        throw new ForbiddenError('invalid_setup_token', 'Kode setup salah');
      }
      if (await gateway.accountExists()) {
        throw new ConflictError('already_set_up', 'Akun sudah dibuat');
      }
      validateNewPassword(input.password);
      if (!isSupportedTimezone(input.timezone)) {
        throw new ValidationError('invalid_input', 'Zona waktu tidak dikenal', {
          issues: [{ path: 'timezone', message: 'unknown_timezone' }],
        });
      }

      const id = deps.ids.uuidv7();
      const now = clock.now();
      try {
        await gateway.createInitialAccount({
          id,
          email: normalizeEmail(input.email),
          displayName: input.displayName.trim(),
          passwordHash: await hasher.hash(normalizePassword(input.password)),
          timezone: input.timezone,
          now,
        });
      } catch (err) {
        // The single-account unique index settles two setup requests that passed the check above together.
        if (isUniqueViolation(err)) throw new ConflictError('already_set_up', 'Akun sudah dibuat');
        throw err;
      }
      logger.info({ outcome: 'setup_completed', userIdPresent: true });
      return issueSession(id, meta);
    },

    async login(input, meta) {
      const email = normalizeEmail(input.email);
      const account = await gateway.findLogin(email);
      const priorFailures = await assertNotLocked(email, account?.userId ?? null, meta);

      const password = normalizePassword(input.password);
      if (!account) {
        await hasher.burn(password);
        return failLogin(email, null, priorFailures, meta);
      }
      if (!(await hasher.verify(account.passwordHash, password))) {
        return failLogin(email, account.userId, priorFailures, meta);
      }

      if (account.totpEnabled) {
        const now = clock.now();
        const token = generateToken();
        const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
        await gateway.createChallenge(hashToken(token), account.userId, now, expiresAt);
        logger.info({ outcome: 'totp_required', userIdPresent: true });
        return { status: 'totp_required', challenge: { token, expiresAt } };
      }

      const session = await issueSession(account.userId, meta);
      logger.info({ outcome: 'login_success', userIdPresent: true });
      return { status: 'authenticated', session };
    },

    async completeTotpLogin(challengeToken, input, meta) {
      await assertNotLocked(null, null, meta);
      const challengeId = hashToken(challengeToken);

      if ('code' in input) {
        const userId = await verifyTotpCode(challengeId, input.code, meta);
        logger.info({ outcome: 'login_success', userIdPresent: true });
        return issueSession(userId, meta);
      }

      const userId = await verifyRecoveryCode(challengeId, input.recoveryCode, meta);
      logger.info({ outcome: 'login_success_recovery', userIdPresent: true });
      return issueSession(userId, meta, async (tx) => {
        const remaining = await sql<{ n: number }>`
          select count(*)::int as n from public.recovery_codes where used_at is null
        `.execute(sqlFor(tx));
        await recordSecurityEvent(tx, {
          event: 'recovery_code.used',
          meta,
          now: clock.now(),
          metadata: { remaining: remaining.rows[0]?.n ?? 0 },
        });
      });
    },

    authenticate,

    async logout(ctx) {
      await uow.write(ctx.scope, async (tx) => {
        await sql`delete from public.sessions where public_id = ${ctx.sessionPublicId}::uuid`.execute(sqlFor(tx));
      });
    },
  };
}
