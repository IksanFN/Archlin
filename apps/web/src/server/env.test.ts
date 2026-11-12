import { describe, expect, it } from 'vitest';
import { loadWebEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/cortex',
  TOTP_ENC_KEY: Buffer.alloc(32, 1).toString('base64'),
  ARCHLIN_PUBLIC_ORIGIN: 'http://localhost:3000',
};

const failureCode = (source: Record<string, string | undefined>): unknown => {
  try {
    loadWebEnv(source);
  } catch (err) {
    return (err as { code?: unknown }).code;
  }
  return undefined;
};

describe('loadWebEnv', () => {
  it('parses a complete environment', () => {
    const env = loadWebEnv({
      ...base,
      NODE_ENV: 'development',
      ARCHLIN_SETUP_TOKEN: 's'.repeat(32),
      ARCHLIN_TEST_MODE: '1',
      LOG_LEVEL: 'debug',
    });
    expect(env).toEqual({
      nodeEnv: 'development',
      databaseUrl: base.DATABASE_URL,
      totpEncKey: base.TOTP_ENC_KEY,
      setupToken: 's'.repeat(32),
      publicOrigin: 'http://localhost:3000',
      testMode: true,
      logLevel: 'debug',
    });
  });

  it('defaults to production, no setup token, test mode off and info logs', () => {
    expect(loadWebEnv(base)).toMatchObject({ nodeEnv: 'production', setupToken: null, testMode: false, logLevel: 'info' });
  });

  it('treats an empty setup token as not configured', () => {
    expect(loadWebEnv({ ...base, ARCHLIN_SETUP_TOKEN: '' }).setupToken).toBeNull();
  });

  it('refuses test mode in production', () => {
    expect(() => loadWebEnv({ ...base, NODE_ENV: 'production', ARCHLIN_TEST_MODE: '1' })).toThrow(
      expect.objectContaining({ code: 'test_mode_in_production' }),
    );
    expect(() => loadWebEnv({ ...base, ARCHLIN_TEST_MODE: '1' })).toThrow(
      expect.objectContaining({ code: 'test_mode_in_production' }),
    );
  });

  it('allows test mode outside production', () => {
    expect(loadWebEnv({ ...base, NODE_ENV: 'test', ARCHLIN_TEST_MODE: '1' }).testMode).toBe(true);
  });

  it('refuses to start with the migrator secret present', () => {
    expect(() => loadWebEnv({ ...base, MIGRATOR_DATABASE_URL: 'postgres://m:p@x/cortex' })).toThrow(
      expect.objectContaining({ code: 'migrator_secret_present' }),
    );
  });

  it('rejects a totp key that is not 32 bytes', () => {
    expect(failureCode({ ...base, TOTP_ENC_KEY: Buffer.alloc(31, 1).toString('base64') })).toBe('invalid_env');
    expect(failureCode({ ...base, TOTP_ENC_KEY: 'not base64 at all!' })).toBe('invalid_env');
    expect(failureCode({ ...base, TOTP_ENC_KEY: undefined })).toBe('invalid_env');
  });

  it('rejects a public origin with a path or trailing slash', () => {
    expect(failureCode({ ...base, ARCHLIN_PUBLIC_ORIGIN: 'http://localhost:3000/app' })).toBe('invalid_env');
    expect(failureCode({ ...base, ARCHLIN_PUBLIC_ORIGIN: 'http://localhost:3000/' })).toBe('invalid_env');
    expect(failureCode({ ...base, ARCHLIN_PUBLIC_ORIGIN: 'ftp://localhost' })).toBe('invalid_env');
  });

  it('rejects a short setup token, a non-postgres url and a malformed flag', () => {
    expect(failureCode({ ...base, ARCHLIN_SETUP_TOKEN: 'short' })).toBe('invalid_env');
    expect(failureCode({ ...base, DATABASE_URL: 'mysql://u:p@h/db' })).toBe('invalid_env');
    expect(failureCode({ ...base, NODE_ENV: 'development', ARCHLIN_TEST_MODE: 'true' })).toBe('invalid_env');
  });

  it('never echoes configuration values in the error message', () => {
    try {
      loadWebEnv({ ...base, TOTP_ENC_KEY: 'super-secret-but-wrong', DATABASE_URL: 'postgres://u:hunter2@h/db?x' });
    } catch (err) {
      expect((err as Error).message).not.toContain('super-secret-but-wrong');
      expect((err as Error).message).not.toContain('hunter2');
      expect((err as Error).message).toContain('TOTP_ENC_KEY');
    }
  });
});
