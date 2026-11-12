import { ownerOf, sqlFor } from '@archlin/db/scoped';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@archlin/kernel';
import type { ReadTx, WriteTx } from '@archlin/kernel';
import { sql } from 'kysely';
import { SECURITY_EVENT_NAMES } from '../../contracts';
import type {
  ChangePasswordInput,
  ConfirmTotpInput,
  ReauthInput,
  RevokeSessionInput,
  SecurityEventName,
  SecurityEventsInput,
  SecurityEventSummary,
  SessionSummary,
  UpdateProfileInput,
  Viewer,
} from '../../contracts';
import type { AuthDeps } from './auth-service';
import { createIdentityGateway } from './identity-gateway';
import { createLoginAttempts } from './login-attempts';
import { isSupportedTimezone } from './normalize';
import { normalizePassword, validateNewPassword } from './password';
import { REAUTH_WINDOW_MS, SESSION_IDLE_MS } from './policy';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes';
import { recordSecurityEvent } from './security-events';
import { insertSession } from './sessions';
import type { AuthContext, IssuedSession, RequestMeta } from './sessions';

export interface AccountService {
  getViewer(ctx: AuthContext): Promise<Viewer>;
  updateProfile(ctx: AuthContext, input: UpdateProfileInput): Promise<Viewer>;
  reauthenticate(ctx: AuthContext, input: ReauthInput, meta: RequestMeta): Promise<{ reauthUntil: string }>;
  changePassword(ctx: AuthContext, input: ChangePasswordInput, meta: RequestMeta): Promise<IssuedSession>;
  beginTotpEnrollment(ctx: AuthContext): Promise<{ secret: string; otpauthUri: string }>;
  confirmTotpEnrollment(
    ctx: AuthContext,
    input: ConfirmTotpInput,
    meta: RequestMeta,
  ): Promise<{ session: IssuedSession; recoveryCodes: readonly string[] }>;
  disableTotp(ctx: AuthContext, meta: RequestMeta): Promise<IssuedSession>;
  regenerateRecoveryCodes(ctx: AuthContext, meta: RequestMeta): Promise<{ recoveryCodes: readonly string[] }>;
  listSessions(ctx: AuthContext): Promise<readonly SessionSummary[]>;
  revokeSession(ctx: AuthContext, input: RevokeSessionInput, meta: RequestMeta): Promise<void>;
  revokeOtherSessions(ctx: AuthContext, meta: RequestMeta): Promise<{ revoked: number }>;
  listSecurityEvents(ctx: AuthContext, input: SecurityEventsInput): Promise<readonly SecurityEventSummary[]>;
}

interface AccountRow {
  email: string;
  password_hash: string;
  totp_enabled: boolean;
  totp_secret_enc: string | null;
  totp_pending_secret_enc: string | null;
  totp_last_used_step: string | null;
}

const isSecurityEventName = (value: string): value is SecurityEventName =>
  (SECURITY_EVENT_NAMES as readonly string[]).includes(value);

const unknownTimezone = (): ValidationError =>
  new ValidationError('invalid_input', 'Zona waktu tidak dikenal', {
    issues: [{ path: 'timezone', message: 'unknown_timezone' }],
  });

const toIssued = ({ token, expiresAt }: IssuedSession): IssuedSession => ({ token, expiresAt });

export function createAccountService(deps: AuthDeps): AccountService {
  const { uow, clock, hasher, totp, secretBox, logger, sleep } = deps;
  const gateway = createIdentityGateway(deps.db);
  const attempts = createLoginAttempts({ gateway, clock, logger, sleep });

  async function loadAccount(tx: ReadTx): Promise<AccountRow> {
    const result = await sql<AccountRow>`
      select email, password_hash, totp_enabled, totp_secret_enc, totp_pending_secret_enc, totp_last_used_step
      from public.users where id = ${ownerOf(tx)}::uuid
    `.execute(sqlFor(tx));
    const row = result.rows[0];
    if (!row) throw new NotFoundError('account_not_found', 'Akun tidak ditemukan');
    return row;
  }

  // Sensitive actions need a password confirmation in the last ten minutes (spec 13.4 K1).
  function requireRecentReauth(ctx: AuthContext): void {
    if (ctx.reauthUntil === null || ctx.reauthUntil.getTime() <= clock.now().getTime()) {
      throw new ForbiddenError('reauth_required', 'Konfirmasi ulang password diperlukan');
    }
  }

  // Drops the caller's session (or all of them) and issues a fresh one in the same transaction, so a leaked
  // pre-change token dies with the change (spec 13.4 K1).
  async function replaceSession(
    tx: WriteTx,
    ctx: AuthContext,
    meta: RequestMeta,
    scope: 'current' | 'all',
  ): Promise<IssuedSession & { readonly publicId: string }> {
    if (scope === 'all') {
      await sql`delete from public.sessions`.execute(sqlFor(tx));
    } else {
      await sql`delete from public.sessions where public_id = ${ctx.sessionPublicId}::uuid`.execute(sqlFor(tx));
    }
    return insertSession(tx, deps, meta);
  }

  async function replaceRecoveryCodes(tx: WriteTx, now: Date): Promise<string[]> {
    const codes = generateRecoveryCodes();
    const owner = ownerOf(tx);
    const rows = codes.map((code) => {
      const normalized = normalizeRecoveryCode(code);
      if (normalized === null) throw new Error('Generated recovery code failed its own normalization');
      return sql`(${owner}::uuid, ${hashRecoveryCode(normalized)}, ${now})`;
    });
    await sql`delete from public.recovery_codes`.execute(sqlFor(tx));
    await sql`insert into public.recovery_codes (user_id, code_hash, created_at) values ${sql.join(rows)}`.execute(sqlFor(tx));
    return codes;
  }

  async function viewerOf(ctx: AuthContext): Promise<Viewer> {
    const result = await uow.read(ctx.scope, (tx) =>
      sql<{
        display_name: string;
        email: string;
        timezone: string;
        totp_enabled: boolean;
        totp_enabled_at: Date | null;
        password_changed_at: Date;
        recovery_codes_remaining: number;
      }>`
        select u.display_name, u.email, s.timezone, u.totp_enabled, u.totp_enabled_at, u.password_changed_at,
               (select count(*)::int from public.recovery_codes r where r.used_at is null) as recovery_codes_remaining
        from public.users u join public.user_settings s on s.owner_id = u.id
        where u.id = ${ownerOf(tx)}::uuid
      `.execute(sqlFor(tx)),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('account_not_found', 'Akun tidak ditemukan');
    return {
      displayName: row.display_name,
      email: row.email,
      timezone: row.timezone,
      totpEnabled: row.totp_enabled,
      totpEnabledAt: row.totp_enabled_at?.toISOString() ?? null,
      recoveryCodesRemaining: row.recovery_codes_remaining,
      passwordChangedAt: row.password_changed_at.toISOString(),
    };
  }

  async function failSecondFactor(email: string, userId: string, meta: RequestMeta): Promise<never> {
    await gateway.recordAttempt({
      email,
      ip: meta.ip,
      userId,
      outcome: 'totp_failed',
      userAgent: meta.userAgent,
      now: clock.now(),
    });
    logger.info({ outcome: 'reauth_totp_failed', userIdPresent: true });
    throw new UnauthorizedError('invalid_code', 'Kode tidak valid');
  }

  return {
    getViewer: viewerOf,

    async updateProfile(ctx, input) {
      if (!isSupportedTimezone(input.timezone)) throw unknownTimezone();
      const now = clock.now();
      await uow.write(ctx.scope, async (tx) => {
        const owner = ownerOf(tx);
        await sql`
          update public.users set display_name = ${input.displayName.trim()}, updated_at = ${now} where id = ${owner}::uuid
        `.execute(sqlFor(tx));
        await sql`
          update public.user_settings set timezone = ${input.timezone}, updated_at = ${now} where owner_id = ${owner}::uuid
        `.execute(sqlFor(tx));
      });
      return viewerOf(ctx);
    },

    async reauthenticate(ctx, input, meta) {
      const account = await uow.read(ctx.scope, loadAccount);
      const userId = ctx.scope.ownerId;
      const priorFailures = await attempts.assertNotLocked(account.email, userId, meta);

      if (!(await hasher.verify(account.password_hash, normalizePassword(input.password)))) {
        return attempts.failPassword(account.email, userId, priorFailures, meta);
      }

      const now = clock.now();
      let timeStep: number | null = null;
      if (account.totp_enabled && account.totp_secret_enc !== null) {
        if (!input.totpCode) {
          throw new ValidationError('invalid_input', 'Kode TOTP diperlukan', {
            issues: [{ path: 'totpCode', message: 'required' }],
          });
        }
        const verification = await totp.verify(
          secretBox.open(account.totp_secret_enc),
          input.totpCode,
          now,
          account.totp_last_used_step === null ? null : Number(account.totp_last_used_step),
        );
        if (!verification.valid) return failSecondFactor(account.email, userId, meta);
        timeStep = verification.timeStep;
      }

      const reauthUntil = new Date(now.getTime() + REAUTH_WINDOW_MS);
      const accepted = await uow.write(ctx.scope, async (tx) => {
        if (timeStep !== null) {
          // The step guard lives in SQL so two parallel requests cannot both spend the same code.
          const spent = await sql`
            update public.users set totp_last_used_step = ${timeStep}::bigint
            where id = ${ownerOf(tx)}::uuid and (totp_last_used_step is null or totp_last_used_step < ${timeStep}::bigint)
            returning id
          `.execute(sqlFor(tx));
          if (spent.rows.length === 0) return false;
        }
        await sql`
          update public.sessions set reauth_until = ${reauthUntil} where public_id = ${ctx.sessionPublicId}::uuid
        `.execute(sqlFor(tx));
        return true;
      });
      if (!accepted) return failSecondFactor(account.email, userId, meta);

      logger.info({ outcome: 'reauthenticated', userIdPresent: true });
      return { reauthUntil: reauthUntil.toISOString() };
    },

    async changePassword(ctx, input, meta) {
      requireRecentReauth(ctx);
      validateNewPassword(input.newPassword);
      // Hash before opening the transaction: argon2 is slow and must not hold a connection.
      const passwordHash = await hasher.hash(normalizePassword(input.newPassword));
      const now = clock.now();
      return uow.write(ctx.scope, async (tx) => {
        await sql`
          update public.users set password_hash = ${passwordHash}, password_changed_at = ${now}, updated_at = ${now}
          where id = ${ownerOf(tx)}::uuid
        `.execute(sqlFor(tx));
        const session = await replaceSession(tx, ctx, meta, 'all');
        await recordSecurityEvent(tx, { event: 'password.changed', meta, now, sessionPublicId: session.publicId });
        return toIssued(session);
      });
    },

    async beginTotpEnrollment(ctx) {
      return uow.write(ctx.scope, async (tx) => {
        const account = await loadAccount(tx);
        if (account.totp_enabled) throw new ConflictError('totp_already_enabled', 'TOTP sudah aktif');
        const secret = totp.generateSecret();
        await sql`
          update public.users set totp_pending_secret_enc = ${secretBox.seal(secret)}, updated_at = ${clock.now()}
          where id = ${ownerOf(tx)}::uuid
        `.execute(sqlFor(tx));
        return { secret, otpauthUri: totp.uri(secret, account.email) };
      });
    },

    async confirmTotpEnrollment(ctx, input, meta) {
      const now = clock.now();
      return uow.write(ctx.scope, async (tx) => {
        const account = await loadAccount(tx);
        if (account.totp_pending_secret_enc === null) {
          throw new ConflictError('no_pending_enrollment', 'Tidak ada pendaftaran TOTP yang sedang berjalan');
        }
        const verification = await totp.verify(secretBox.open(account.totp_pending_secret_enc), input.code, now, null);
        if (!verification.valid) throw new UnauthorizedError('invalid_code', 'Kode tidak valid');

        await sql`
          update public.users
          set totp_secret_enc = totp_pending_secret_enc, totp_pending_secret_enc = null, totp_enabled = true,
              totp_enabled_at = ${now}, totp_last_used_step = ${verification.timeStep}::bigint, updated_at = ${now}
          where id = ${ownerOf(tx)}::uuid
        `.execute(sqlFor(tx));
        const recoveryCodes = await replaceRecoveryCodes(tx, now);
        const session = await replaceSession(tx, ctx, meta, 'current');
        await recordSecurityEvent(tx, { event: 'totp.enabled', meta, now, sessionPublicId: session.publicId });
        return { session: toIssued(session), recoveryCodes };
      });
    },

    async disableTotp(ctx, meta) {
      requireRecentReauth(ctx);
      const now = clock.now();
      return uow.write(ctx.scope, async (tx) => {
        const account = await loadAccount(tx);
        if (!account.totp_enabled) throw new ConflictError('totp_not_enabled', 'TOTP belum aktif');
        await sql`
          update public.users
          set totp_secret_enc = null, totp_pending_secret_enc = null, totp_enabled = false, totp_enabled_at = null,
              totp_last_used_step = null, updated_at = ${now}
          where id = ${ownerOf(tx)}::uuid
        `.execute(sqlFor(tx));
        await sql`delete from public.recovery_codes`.execute(sqlFor(tx));
        const session = await replaceSession(tx, ctx, meta, 'current');
        await recordSecurityEvent(tx, { event: 'totp.disabled', meta, now, sessionPublicId: session.publicId });
        return toIssued(session);
      });
    },

    async regenerateRecoveryCodes(ctx, meta) {
      requireRecentReauth(ctx);
      const now = clock.now();
      return uow.write(ctx.scope, async (tx) => {
        const account = await loadAccount(tx);
        if (!account.totp_enabled) throw new ConflictError('totp_not_enabled', 'TOTP belum aktif');
        const recoveryCodes = await replaceRecoveryCodes(tx, now);
        await recordSecurityEvent(tx, {
          event: 'recovery_codes.regenerated',
          meta,
          now,
          sessionPublicId: ctx.sessionPublicId,
        });
        return { recoveryCodes };
      });
    },

    async listSessions(ctx) {
      const now = clock.now();
      const idleCutoff = new Date(now.getTime() - SESSION_IDLE_MS);
      const result = await uow.read(ctx.scope, (tx) =>
        sql<{ public_id: string; created_at: Date; last_seen_at: Date; user_agent: string | null }>`
          select public_id, created_at, last_seen_at, user_agent from public.sessions
          where expires_at > ${now} and last_seen_at > ${idleCutoff}
          order by last_seen_at desc, created_at desc
        `.execute(sqlFor(tx)),
      );
      return result.rows.map((row) => ({
        publicId: row.public_id,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
        userAgent: row.user_agent,
        current: row.public_id === ctx.sessionPublicId,
      }));
    },

    async revokeSession(ctx, input, meta) {
      const publicId = input.publicId.toLowerCase();
      if (publicId === ctx.sessionPublicId) {
        throw new ValidationError('invalid_input', 'Sesi ini sedang dipakai', {
          issues: [{ path: 'publicId', message: 'cannot_revoke_current' }],
        });
      }
      const now = clock.now();
      await uow.write(ctx.scope, async (tx) => {
        const deleted = await sql`delete from public.sessions where public_id = ${publicId}::uuid returning public_id`.execute(
          sqlFor(tx),
        );
        if (deleted.rows.length === 0) throw new NotFoundError('session_not_found', 'Sesi tidak ditemukan');
        await recordSecurityEvent(tx, { event: 'session.revoked', meta, now, sessionPublicId: publicId });
      });
    },

    async revokeOtherSessions(ctx, meta) {
      const now = clock.now();
      return uow.write(ctx.scope, async (tx) => {
        const deleted = await sql`
          delete from public.sessions where public_id <> ${ctx.sessionPublicId}::uuid returning public_id
        `.execute(sqlFor(tx));
        const revoked = deleted.rows.length;
        if (revoked > 0) {
          await recordSecurityEvent(tx, {
            event: 'session.revoked',
            meta,
            now,
            sessionPublicId: ctx.sessionPublicId,
            metadata: { count: revoked },
          });
        }
        return { revoked };
      });
    },

    async listSecurityEvents(ctx, input) {
      const result = await uow.read(ctx.scope, (tx) =>
        sql<{ event: string; created_at: Date; ip: string | null; user_agent: string | null }>`
          select event, created_at, host(ip) as ip, user_agent from public.security_events
          order by created_at desc, id desc limit ${input.limit}
        `.execute(sqlFor(tx)),
      );
      return result.rows.map((row) => {
        if (!isSecurityEventName(row.event)) throw new Error(`Unexpected security event name: ${row.event}`);
        return { event: row.event, createdAt: row.created_at.toISOString(), ip: row.ip, userAgent: row.user_agent };
      });
    },
  };
}
