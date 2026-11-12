import { z } from 'zod';

export interface WebEnv {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  totpEncKey: string;
  setupToken: string | null;
  publicOrigin: string;
  testMode: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export type StartupConfigErrorCode = 'invalid_env' | 'test_mode_in_production' | 'migrator_secret_present';

export class StartupConfigError extends Error {
  override readonly name = 'StartupConfigError';
  readonly code: StartupConfigErrorCode;

  constructor(code: StartupConfigErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const KEYS = [
  'NODE_ENV',
  'DATABASE_URL',
  'TOTP_ENC_KEY',
  'ARCHLIN_SETUP_TOKEN',
  'ARCHLIN_PUBLIC_ORIGIN',
  'ARCHLIN_TEST_MODE',
  'LOG_LEVEL',
] as const;

const isPostgresUrl = (value: string): boolean => {
  try {
    return ['postgres:', 'postgresql:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

// The strict base64 pattern matters: Buffer.from silently drops invalid characters, so a typo could still "decode".
const isKey32Bytes = (value: string): boolean =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').length === 32;

// A bare origin is what the CSRF check compares against; a path or trailing slash would never match.
const isBareOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
};

const envSchema = z.strictObject({
  // An unset NODE_ENV means production: strict CSP and the test mode guard stay on unless someone opts out.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DATABASE_URL: z.string().refine(isPostgresUrl),
  TOTP_ENC_KEY: z.string().refine(isKey32Bytes),
  ARCHLIN_SETUP_TOKEN: z.string().min(32).optional(),
  ARCHLIN_PUBLIC_ORIGIN: z.string().refine(isBareOrigin),
  ARCHLIN_TEST_MODE: z.literal('1').optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// Takes the source as an argument instead of reading process.env: bundlers statically replace process.env.NODE_ENV.
export function loadWebEnv(source: Readonly<Record<string, string | undefined>>): WebEnv {
  if (source.MIGRATOR_DATABASE_URL) {
    throw new StartupConfigError('migrator_secret_present', 'MIGRATOR_DATABASE_URL must not be set for the web process');
  }

  const picked = Object.fromEntries(
    KEYS.flatMap((key) => {
      const value = source[key];
      return value === undefined || value === '' ? [] : [[key, value]];
    }),
  );
  const parsed = envSchema.safeParse(picked);
  if (!parsed.success) {
    // Names only: values such as the encryption key or database password must never reach logs.
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)'))];
    throw new StartupConfigError('invalid_env', `Invalid environment variables: ${names.join(', ')}`);
  }

  const env = parsed.data;
  if (env.ARCHLIN_TEST_MODE === '1' && env.NODE_ENV === 'production') {
    throw new StartupConfigError('test_mode_in_production', 'ARCHLIN_TEST_MODE=1 is not allowed with NODE_ENV=production');
  }

  return {
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    totpEncKey: env.TOTP_ENC_KEY,
    setupToken: env.ARCHLIN_SETUP_TOKEN ?? null,
    publicOrigin: env.ARCHLIN_PUBLIC_ORIGIN,
    testMode: env.ARCHLIN_TEST_MODE === '1',
    logLevel: env.LOG_LEVEL,
  };
}
