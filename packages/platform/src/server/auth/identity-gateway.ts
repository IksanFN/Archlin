import { sql } from 'kysely';
import type { Kysely } from 'kysely';

// The only file that calls the auth_* gateway functions. They are SECURITY DEFINER, so the pre-auth steps (which have
// no owner yet) run on the plain pool; every parameter is bound and cast, nothing is interpolated into the text.

export interface LoginRecord {
  readonly userId: string;
  readonly passwordHash: string;
  readonly totpEnabled: boolean;
}

export interface ChallengeRecord {
  readonly userId: string;
  readonly totpSecretEnc: string | null;
  readonly totpLastUsedStep: number | null;
}

export interface SessionRecord {
  readonly userId: string;
  readonly publicId: string;
  readonly reauthUntil: Date | null;
}

export type AttemptOutcome = 'password_failed' | 'totp_failed' | 'recovery_failed' | 'locked';

export interface AttemptInput {
  readonly email: string | null;
  readonly ip: string | null;
  readonly userId: string | null;
  readonly outcome: AttemptOutcome;
  readonly userAgent: string | null;
  readonly now: Date;
}

export interface NewAccountInput {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly timezone: string;
  readonly now: Date;
}

export interface IdentityGateway {
  accountExists(): Promise<boolean>;
  createInitialAccount(input: NewAccountInput): Promise<void>;
  findLogin(email: string): Promise<LoginRecord | null>;
  recordAttempt(input: AttemptInput): Promise<void>;
  countRecentFailures(email: string | null, ip: string | null, since: Date): Promise<{ byEmail: number; byIp: number }>;
  createChallenge(id: string, userId: string, now: Date, expiresAt: Date): Promise<void>;
  getChallenge(id: string, now: Date): Promise<ChallengeRecord | null>;
  finishChallenge(id: string, success: boolean, timeStep: number | null, now: Date): Promise<boolean>;
  consumeRecoveryCode(challengeId: string, codeHash: string, now: Date): Promise<string | null>;
  resolveSession(id: string, now: Date): Promise<SessionRecord | null>;
}

export function createIdentityGateway(db: Kysely<unknown>): IdentityGateway {
  return {
    async accountExists() {
      const result = await sql<{ exists: boolean }>`select public.auth_account_exists() as exists`.execute(db);
      return result.rows[0]?.exists === true;
    },

    async createInitialAccount(input) {
      await sql`
        select public.auth_create_initial_account(
          ${input.id}::uuid, ${input.email}::text, ${input.displayName}::text, ${input.passwordHash}::text,
          ${input.timezone}::text, ${input.now}::timestamptz
        )
      `.execute(db);
    },

    async findLogin(email) {
      const result = await sql<{ user_id: string; password_hash: string; totp_enabled: boolean }>`
        select * from public.auth_find_login(${email}::text)
      `.execute(db);
      const row = result.rows[0];
      return row ? { userId: row.user_id, passwordHash: row.password_hash, totpEnabled: row.totp_enabled } : null;
    },

    async recordAttempt(input) {
      await sql`
        select public.auth_record_attempt(
          ${input.email}::text, ${input.ip}::inet, ${input.userId}::uuid, ${input.outcome}::text,
          ${input.userAgent}::text, ${input.now}::timestamptz
        )
      `.execute(db);
    },

    async countRecentFailures(email, ip, since) {
      const result = await sql<{ by_email: number; by_ip: number }>`
        select * from public.auth_count_recent_failures(${email}::text, ${ip}::inet, ${since}::timestamptz)
      `.execute(db);
      const row = result.rows[0];
      return { byEmail: row?.by_email ?? 0, byIp: row?.by_ip ?? 0 };
    },

    async createChallenge(id, userId, now, expiresAt) {
      await sql`
        select public.auth_create_challenge(${id}::text, ${userId}::uuid, ${now}::timestamptz, ${expiresAt}::timestamptz)
      `.execute(db);
    },

    async getChallenge(id, now) {
      const result = await sql<{ user_id: string; totp_secret_enc: string | null; totp_last_used_step: string | null }>`
        select * from public.auth_get_challenge(${id}::text, ${now}::timestamptz)
      `.execute(db);
      const row = result.rows[0];
      if (!row) return null;
      return {
        userId: row.user_id,
        totpSecretEnc: row.totp_secret_enc,
        // pg returns bigint as a string.
        totpLastUsedStep: row.totp_last_used_step === null ? null : Number(row.totp_last_used_step),
      };
    },

    async finishChallenge(id, success, timeStep, now) {
      const result = await sql<{ finished: boolean }>`
        select public.auth_finish_challenge(${id}::text, ${success}::boolean, ${timeStep}::bigint, ${now}::timestamptz) as finished
      `.execute(db);
      return result.rows[0]?.finished === true;
    },

    async consumeRecoveryCode(challengeId, codeHash, now) {
      const result = await sql<{ user_id: string | null }>`
        select public.auth_consume_recovery_code(${challengeId}::text, ${codeHash}::text, ${now}::timestamptz) as user_id
      `.execute(db);
      return result.rows[0]?.user_id ?? null;
    },

    async resolveSession(id, now) {
      const result = await sql<{ user_id: string; public_id: string; reauth_until: Date | null }>`
        select * from public.auth_resolve_session(${id}::text, ${now}::timestamptz)
      `.execute(db);
      const row = result.rows[0];
      return row ? { userId: row.user_id, publicId: row.public_id, reauthUntil: row.reauth_until } : null;
    },
  };
}
