import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadWorkerEnv, WorkerConfigError } from './env';

const DATABASE_URL = 'postgres://cortex_app:secret@127.0.0.1:54329/cortex';
const ARCHLIN_FILES_DIR = join(tmpdir(), 'archlin-files');

describe('loadWorkerEnv', () => {
  it('reads the database url and defaults the log level to info', () => {
    expect(loadWorkerEnv({ ARCHLIN_FILES_DIR, DATABASE_URL })).toEqual({ databaseUrl: DATABASE_URL, logLevel: 'info', filesDir: ARCHLIN_FILES_DIR });
  });

  it('accepts an explicit log level', () => {
    expect(loadWorkerEnv({ ARCHLIN_FILES_DIR, DATABASE_URL, LOG_LEVEL: 'warn' }).logLevel).toBe('warn');
  });

  it('refuses to start when the migrator credential is present', () => {
    const attempt = () => loadWorkerEnv({ ARCHLIN_FILES_DIR, DATABASE_URL, MIGRATOR_DATABASE_URL: 'postgres://cortex_migrator:x@h/db' });
    expect(attempt).toThrow(WorkerConfigError);
    expect(attempt).toThrow(expect.objectContaining({ code: 'migrator_secret_present' }));
  });

  it('refuses an empty migrator variable too: presence is the problem, not the value', () => {
    expect(() => loadWorkerEnv({ ARCHLIN_FILES_DIR, DATABASE_URL, MIGRATOR_DATABASE_URL: '' })).toThrow(
      expect.objectContaining({ code: 'migrator_secret_present' }),
    );
  });

  it.each([[undefined], ['not a url'], ['http://example.com/db']])('rejects database url %j', (value) => {
    expect(() => loadWorkerEnv({ ARCHLIN_FILES_DIR, DATABASE_URL: value })).toThrow(expect.objectContaining({ code: 'invalid_env' }));
  });

  it('requires an absolute ARCHLIN_FILES_DIR', () => {
    expect(() => loadWorkerEnv({ DATABASE_URL, ARCHLIN_FILES_DIR: 'relative/files' })).toThrow(
      expect.objectContaining({ code: 'invalid_env', message: expect.stringContaining('ARCHLIN_FILES_DIR') }),
    );
    expect(() => loadWorkerEnv({ DATABASE_URL })).toThrow(expect.objectContaining({ code: 'invalid_env' }));
    expect(loadWorkerEnv({ DATABASE_URL, ARCHLIN_FILES_DIR }).filesDir).toBe(ARCHLIN_FILES_DIR);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadWorkerEnv({ ARCHLIN_FILES_DIR, DATABASE_URL, LOG_LEVEL: 'verbose' })).toThrow(expect.objectContaining({ code: 'invalid_env' }));
  });

  it('never puts a value in the error message', () => {
    try {
      loadWorkerEnv({ ARCHLIN_FILES_DIR, DATABASE_URL: 'postgres://cortex_app:hunter2@h/db', LOG_LEVEL: 'nope' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('hunter2');
    }
  });
});
