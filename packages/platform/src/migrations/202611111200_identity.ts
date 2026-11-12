import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Identity tables, row level security and the narrow pre-auth gateway (spec 6, 13.4 K3).
// Every statement is static text: nothing here is built from input.

const TABLES = [
  `CREATE TABLE public.users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 320),
    display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
    password_hash text NOT NULL,
    password_changed_at timestamptz NOT NULL,
    totp_secret_enc text,
    totp_pending_secret_enc text,
    totp_enabled boolean NOT NULL DEFAULT false,
    totp_enabled_at timestamptz,
    totp_last_used_step bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT totp_enabled OR totp_secret_enc IS NOT NULL)
  )`,
  // Single account (spec 13.3). The constant expression makes every row collide with every other row.
  `CREATE UNIQUE INDEX users_single_account ON public.users ((true))`,

  `CREATE TABLE public.user_settings (
    owner_id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
    timezone text NOT NULL DEFAULT 'Asia/Jakarta',
    digest_time time NOT NULL DEFAULT '07:30',
    quiet_start time NOT NULL DEFAULT '22:00',
    quiet_end time NOT NULL DEFAULT '07:00',
    skip_weekends boolean NOT NULL DEFAULT false,
    channels_enabled text[] NOT NULL DEFAULT '{webpush}',
    email_to text,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // `id` is the sha256 hex of the session token; the token itself is never stored.
  `CREATE TABLE public.sessions (
    id text PRIMARY KEY,
    public_id uuid NOT NULL UNIQUE,
    user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    reauth_until timestamptz,
    user_agent text CHECK (length(user_agent) <= 512)
  )`,
  `CREATE INDEX sessions_user_id_idx ON public.sessions (user_id)`,

  `CREATE TABLE public.auth_challenges (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose = 'totp_login'),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    attempts int NOT NULL DEFAULT 0,
    consumed_at timestamptz
  )`,

  `CREATE TABLE public.recovery_codes (
    user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    created_at timestamptz NOT NULL,
    used_at timestamptz,
    PRIMARY KEY (user_id, code_hash)
  )`,

  `CREATE TABLE public.api_tokens (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    token_hash text NOT NULL UNIQUE,
    scopes text[] NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ array['capture:write']),
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL,
    UNIQUE (owner_id, id)
  )`,

  `CREATE TABLE public.security_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    event text NOT NULL CHECK (event IN (
      'login.success', 'login.failed', 'login.locked', 'session.revoked', 'password.changed',
      'totp.enabled', 'totp.disabled', 'recovery_code.used', 'recovery_codes.regenerated',
      'api_token.created', 'api_token.revoked'
    )),
    ip inet,
    user_agent text CHECK (length(user_agent) <= 512),
    session_public_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX security_events_owner_created_idx ON public.security_events (owner_id, created_at DESC)`,

  // Pre-auth audit: the owner is often unknown (wrong email), so there is no owner column to protect.
  `CREATE TABLE public.auth_attempts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text,
    ip inet,
    user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
    outcome text NOT NULL CHECK (outcome IN ('password_failed', 'totp_failed', 'recovery_failed', 'locked', 'succeeded')),
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX auth_attempts_email_created_idx ON public.auth_attempts (email, created_at)`,
  `CREATE INDEX auth_attempts_ip_created_idx ON public.auth_attempts (ip, created_at)`,
];

// Table -> column holding the owner. The expression is the one mandated for every tenant table (plan constraints):
// `current_setting(..., true)` returns NULL instead of raising when unset, and nullif makes '' behave the same.
const OWNER_POLICY_COLUMN = {
  users: 'id',
  user_settings: 'owner_id',
  sessions: 'user_id',
  recovery_codes: 'user_id',
  api_tokens: 'owner_id',
  security_events: 'owner_id',
} as const;
const IDENTITY_ONLY_TABLES = ['auth_challenges', 'auth_attempts'] as const;

const ownerExpression = `nullif(current_setting('app.owner_id', true), '')::uuid`;

const POLICIES = [
  ...Object.entries(OWNER_POLICY_COLUMN).flatMap(([table, column]) => [
    `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY ${table}_owner ON public.${table} FOR ALL TO cortex_app
       USING (${column} = ${ownerExpression}) WITH CHECK (${column} = ${ownerExpression})`,
    `CREATE POLICY ${table}_identity ON public.${table} FOR ALL TO cortex_identity USING (true) WITH CHECK (true)`,
  ]),
  // Pre-auth tables: no policy for cortex_app, so even a stray grant would expose no rows.
  ...IDENTITY_ONLY_TABLES.flatMap((table) => [
    `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY ${table}_identity ON public.${table} FOR ALL TO cortex_identity USING (true) WITH CHECK (true)`,
  ]),
];

const GRANTS = [
  `GRANT SELECT ON public.users TO cortex_app`,
  // Never email or id. totp_last_used_step is writable because reauthentication and TOTP enrollment advance it;
  // the pre-login path goes through auth_finish_challenge.
  `GRANT UPDATE (display_name, password_hash, password_changed_at, totp_secret_enc, totp_pending_secret_enc,
                 totp_enabled, totp_enabled_at, totp_last_used_step, updated_at) ON public.users TO cortex_app`,
  `GRANT SELECT, UPDATE ON public.user_settings TO cortex_app`,
  `GRANT SELECT, INSERT, DELETE ON public.sessions TO cortex_app`,
  `GRANT UPDATE (last_seen_at, reauth_until) ON public.sessions TO cortex_app`,
  `GRANT SELECT, INSERT, DELETE ON public.recovery_codes TO cortex_app`,
  `GRANT SELECT, INSERT ON public.api_tokens TO cortex_app`,
  `GRANT UPDATE (name, revoked_at) ON public.api_tokens TO cortex_app`,
  `GRANT SELECT, INSERT ON public.security_events TO cortex_app`,
  `GRANT USAGE ON SEQUENCE public.security_events_id_seq TO cortex_app`,
  `GRANT SELECT ON public.kysely_migration TO cortex_app`,
  // cortex_identity (owner of the gateway functions; needs exactly what the functions touch)
  `GRANT SELECT, INSERT ON public.users TO cortex_identity`,
  `GRANT UPDATE (totp_last_used_step) ON public.users TO cortex_identity`,
  `GRANT INSERT ON public.user_settings TO cortex_identity`,
  `GRANT SELECT ON public.sessions TO cortex_identity`,
  `GRANT UPDATE (last_seen_at) ON public.sessions TO cortex_identity`,
  `GRANT SELECT, INSERT, UPDATE ON public.auth_challenges TO cortex_identity`,
  `GRANT SELECT ON public.recovery_codes TO cortex_identity`,
  `GRANT UPDATE (used_at) ON public.recovery_codes TO cortex_identity`,
  `GRANT SELECT ON public.api_tokens TO cortex_identity`,
  `GRANT UPDATE (last_used_at) ON public.api_tokens TO cortex_identity`,
  `GRANT INSERT ON public.security_events TO cortex_identity`,
  `GRANT USAGE ON SEQUENCE public.security_events_id_seq TO cortex_identity`,
  `GRANT SELECT, INSERT ON public.auth_attempts TO cortex_identity`,
  `GRANT USAGE ON SEQUENCE public.auth_attempts_id_seq TO cortex_identity`,
];

interface GatewayFunction {
  readonly signature: string; // name(argument types), used for GRANT/REVOKE/ALTER
  readonly create: string;
}

// Time always comes from the p_now parameter (the application Clock), never from now().
// Every column reference is qualified: RETURNS TABLE columns are variables inside plpgsql and would be ambiguous.
const GATEWAY: readonly GatewayFunction[] = [
  {
    signature: 'auth_account_exists()',
    create: `CREATE FUNCTION public.auth_account_exists() RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        RETURN EXISTS (SELECT 1 FROM public.users);
      END $$`,
  },
  {
    signature: 'auth_create_initial_account(uuid, text, text, text, text, timestamptz)',
    create: `CREATE FUNCTION public.auth_create_initial_account(
        p_id uuid, p_email text, p_display_name text, p_password_hash text, p_timezone text, p_now timestamptz
      ) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        -- A second account violates users_single_account (23505), which also settles parallel setup requests.
        INSERT INTO public.users (id, email, display_name, password_hash, password_changed_at, created_at, updated_at)
        VALUES (p_id, p_email, p_display_name, p_password_hash, p_now, p_now, p_now);
        INSERT INTO public.user_settings (owner_id, timezone, updated_at) VALUES (p_id, p_timezone, p_now);
      END $$`,
  },
  {
    signature: 'auth_find_login(text)',
    create: `CREATE FUNCTION public.auth_find_login(p_email text)
      RETURNS TABLE (user_id uuid, password_hash text, totp_enabled boolean)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        RETURN QUERY SELECT u.id, u.password_hash, u.totp_enabled FROM public.users u WHERE u.email = p_email;
      END $$`,
  },
  {
    signature: 'auth_record_attempt(text, inet, uuid, text, text, timestamptz)',
    create: `CREATE FUNCTION public.auth_record_attempt(
        p_email text, p_ip inet, p_user_id uuid, p_outcome text, p_user_agent text, p_now timestamptz
      ) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        INSERT INTO public.auth_attempts (email, ip, user_id, outcome, created_at)
        VALUES (p_email, p_ip, p_user_id, p_outcome, p_now);
        IF p_user_id IS NOT NULL AND p_outcome IN ('password_failed', 'totp_failed', 'recovery_failed', 'locked') THEN
          INSERT INTO public.security_events (owner_id, event, ip, user_agent, metadata, created_at)
          VALUES (
            p_user_id,
            CASE WHEN p_outcome = 'locked' THEN 'login.locked' ELSE 'login.failed' END,
            p_ip,
            left(p_user_agent, 512),
            jsonb_build_object('stage', p_outcome),
            p_now
          );
        END IF;
      END $$`,
  },
  {
    signature: 'auth_count_recent_failures(text, inet, timestamptz)',
    create: `CREATE FUNCTION public.auth_count_recent_failures(p_email text, p_ip inet, p_since timestamptz)
      RETURNS TABLE (by_email int, by_ip int)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        RETURN QUERY SELECT
          (SELECT count(*)::int FROM public.auth_attempts a
            WHERE a.email = p_email AND a.created_at >= p_since
              AND a.outcome IN ('password_failed', 'totp_failed', 'recovery_failed')),
          (SELECT count(*)::int FROM public.auth_attempts a
            WHERE a.ip = p_ip AND a.created_at >= p_since
              AND a.outcome IN ('password_failed', 'totp_failed', 'recovery_failed'));
      END $$`,
  },
  {
    signature: 'auth_create_challenge(text, uuid, timestamptz, timestamptz)',
    create: `CREATE FUNCTION public.auth_create_challenge(p_id text, p_user_id uuid, p_now timestamptz, p_expires_at timestamptz)
      RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        INSERT INTO public.auth_challenges (id, user_id, purpose, created_at, expires_at)
        VALUES (p_id, p_user_id, 'totp_login', p_now, p_expires_at);
      END $$`,
  },
  {
    signature: 'auth_get_challenge(text, timestamptz)',
    create: `CREATE FUNCTION public.auth_get_challenge(p_id text, p_now timestamptz)
      RETURNS TABLE (user_id uuid, totp_secret_enc text, totp_last_used_step bigint)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        RETURN QUERY
          SELECT c.user_id, u.totp_secret_enc, u.totp_last_used_step
          FROM public.auth_challenges c
          JOIN public.users u ON u.id = c.user_id
          WHERE c.id = p_id AND c.consumed_at IS NULL AND c.expires_at > p_now;
      END $$`,
  },
  {
    // One function = one transaction: the replay guard on the TOTP step and the challenge consumption cannot diverge.
    signature: 'auth_finish_challenge(text, boolean, bigint, timestamptz)',
    create: `CREATE FUNCTION public.auth_finish_challenge(p_id text, p_success boolean, p_time_step bigint, p_now timestamptz)
      RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE v_user uuid;
      BEGIN
        IF p_success THEN
          UPDATE public.users u SET totp_last_used_step = p_time_step
           WHERE u.id = (SELECT c.user_id FROM public.auth_challenges c
                          WHERE c.id = p_id AND c.consumed_at IS NULL AND c.expires_at > p_now)
             AND (u.totp_last_used_step IS NULL OR u.totp_last_used_step < p_time_step)
          RETURNING u.id INTO v_user;
          IF v_user IS NOT NULL THEN
            UPDATE public.auth_challenges SET consumed_at = p_now WHERE id = p_id AND consumed_at IS NULL;
            RETURN FOUND;
          END IF;
        END IF;
        UPDATE public.auth_challenges
           SET attempts = attempts + 1,
               consumed_at = CASE WHEN attempts + 1 >= 5 THEN p_now ELSE consumed_at END
         WHERE id = p_id AND consumed_at IS NULL;
        RETURN false;
      END $$`,
  },
  {
    signature: 'auth_consume_recovery_code(text, text, timestamptz)',
    create: `CREATE FUNCTION public.auth_consume_recovery_code(p_challenge_id text, p_code_hash text, p_now timestamptz)
      RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE v_user uuid;
      BEGIN
        SELECT user_id INTO v_user FROM public.auth_challenges
         WHERE id = p_challenge_id AND consumed_at IS NULL AND expires_at > p_now FOR UPDATE;
        IF v_user IS NULL THEN RETURN NULL; END IF;
        UPDATE public.recovery_codes SET used_at = p_now
         WHERE user_id = v_user AND code_hash = p_code_hash AND used_at IS NULL;
        IF NOT FOUND THEN
          UPDATE public.auth_challenges
             SET attempts = attempts + 1,
                 consumed_at = CASE WHEN attempts + 1 >= 5 THEN p_now ELSE consumed_at END
           WHERE id = p_challenge_id;
          RETURN NULL;
        END IF;
        UPDATE public.auth_challenges SET consumed_at = p_now WHERE id = p_challenge_id;
        RETURN v_user;
      END $$`,
  },
  {
    signature: 'auth_resolve_session(text, timestamptz)',
    create: `CREATE FUNCTION public.auth_resolve_session(p_id text, p_now timestamptz)
      RETURNS TABLE (user_id uuid, public_id uuid, reauth_until timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        -- Sliding activity marker, written at most once per minute to avoid a write on every request.
        UPDATE public.sessions s SET last_seen_at = p_now
         WHERE s.id = p_id AND s.expires_at > p_now
           AND s.last_seen_at > p_now - interval '7 days'
           AND s.last_seen_at < p_now - interval '60 seconds';
        RETURN QUERY
          SELECT s.user_id, s.public_id, s.reauth_until FROM public.sessions s
           WHERE s.id = p_id AND s.expires_at > p_now AND s.last_seen_at > p_now - interval '7 days';
      END $$`,
  },
  {
    signature: 'auth_resolve_api_token(text, timestamptz)',
    create: `CREATE FUNCTION public.auth_resolve_api_token(p_hash text, p_now timestamptz)
      RETURNS TABLE (token_id uuid, owner_id uuid, scopes text[])
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        UPDATE public.api_tokens t SET last_used_at = p_now WHERE t.token_hash = p_hash AND t.revoked_at IS NULL;
        RETURN QUERY
          SELECT t.id, t.owner_id, t.scopes FROM public.api_tokens t
           WHERE t.token_hash = p_hash AND t.revoked_at IS NULL;
      END $$`,
  },
  {
    signature: 'auth_list_owner_ids()',
    create: `CREATE FUNCTION public.auth_list_owner_ids() RETURNS SETOF uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        RETURN QUERY SELECT u.id FROM public.users u;
      END $$`,
  },
];

// Grants and the owner change happen while cortex_migrator still owns the function; ALTER OWNER carries the ACL over.
const GATEWAY_STATEMENTS = GATEWAY.flatMap(({ signature, create }) => [
  create,
  `REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION public.${signature} TO cortex_app`,
  `ALTER FUNCTION public.${signature} OWNER TO cortex_identity`,
]);

export const identityMigration: Migration = {
  async up(db) {
    for (const statement of [...TABLES, ...POLICIES, ...GRANTS, ...GATEWAY_STATEMENTS]) {
      await sql.raw(statement).execute(db);
    }
  },
};
