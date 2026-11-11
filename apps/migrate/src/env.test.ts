import { describe, expect, it } from 'vitest';
import { loadMigrateEnv } from './env';

const URL_WITH_SECRET = 'postgres://cortex_migrator:s3cr3t-pw@127.0.0.1:5432/cortex';

describe('loadMigrateEnv', () => {
  it('reads the migrator url and defaults the log level to info', () => {
    expect(loadMigrateEnv({ MIGRATOR_DATABASE_URL: URL_WITH_SECRET })).toEqual({
      MIGRATOR_DATABASE_URL: URL_WITH_SECRET,
      LOG_LEVEL: 'info',
    });
  });

  it('ignores unrelated variables of the surrounding environment', () => {
    const env = loadMigrateEnv({ MIGRATOR_DATABASE_URL: URL_WITH_SECRET, LOG_LEVEL: 'warn', PATH: '/bin', APP_DATABASE_URL: 'x' });
    expect(env).toEqual({ MIGRATOR_DATABASE_URL: URL_WITH_SECRET, LOG_LEVEL: 'warn' });
  });

  it('fails when the migrator url is missing', () => {
    expect(() => loadMigrateEnv({})).toThrow(/MIGRATOR_DATABASE_URL/);
  });

  it('names the invalid variable without echoing its value', () => {
    const attempt = () => loadMigrateEnv({ MIGRATOR_DATABASE_URL: 's3cr3t-pw is not a url' });
    expect(attempt).toThrow(/MIGRATOR_DATABASE_URL/);
    expect(attempt).not.toThrow(/s3cr3t-pw/);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadMigrateEnv({ MIGRATOR_DATABASE_URL: URL_WITH_SECRET, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
