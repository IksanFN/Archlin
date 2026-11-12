import { ValidationError } from '@archlin/kernel';
import { createMemoryDestination } from '@archlin/testing/logging';
import { describe, expect, it } from 'vitest';
import { createLogger } from './create-logger';
import { serializeError } from './serializers';

const SENTINEL = 'SENTINEL-7f3a-should-never-appear';

const newLogger = () => {
  const dest = createMemoryDestination();
  return { dest, log: createLogger({ level: 'info', service: 'test', destination: dest }) };
};

describe('createLogger redaction', () => {
  it('redacts credential-like fields at any depth', () => {
    const { dest, log } = newLogger();
    log.info({ input: { password: SENTINEL, token: SENTINEL, code: SENTINEL } }, 'login attempt');
    expect(dest.text()).not.toContain(SENTINEL);
    expect(dest.text()).toContain('[Redacted]');
  });

  it('redacts credential-like fields at the top level and three levels deep', () => {
    const { dest, log } = newLogger();
    log.info({ password: SENTINEL, token: SENTINEL, totp: SENTINEL }, 'top level');
    log.info({ a: { b: { password: SENTINEL, recoveryCode: SENTINEL, setupToken: SENTINEL } } }, 'nested');
    expect(dest.text()).not.toContain(SENTINEL);
  });

  it('redacts request authorization and cookie headers and response set-cookie', () => {
    const { dest, log } = newLogger();
    log.info({ req: { headers: { authorization: SENTINEL, cookie: SENTINEL } }, res: { headers: { 'set-cookie': SENTINEL } } }, 'http');
    expect(dest.text()).not.toContain(SENTINEL);
  });

  it('binds service and child bindings', () => {
    const { dest, log } = newLogger();
    log.child({ module: 'auth' }).info({}, 'hello');
    const line = JSON.parse(dest.lines()[0] ?? '{}') as Record<string, unknown>;
    expect(line).toMatchObject({ service: 'test', module: 'auth', msg: 'hello', level: 30 });
  });

  it('drops entries below the configured level', () => {
    const { dest, log } = newLogger();
    log.debug({}, 'too quiet');
    expect(dest.lines()).toEqual([]);
  });

  it('keeps the error code of a logged error readable despite the credential code redaction', () => {
    const { dest, log } = newLogger();
    log.error({ err: Object.assign(new Error('boom'), { code: '23505', detail: SENTINEL }) }, 'failed');
    const line = JSON.parse(dest.lines()[0] ?? '{}') as { err?: { errorCode?: string } };
    expect(line.err?.errorCode).toBe('23505');
    expect(dest.text()).not.toContain(SENTINEL);
  });
});

describe('serializeError', () => {
  it('drops pg error detail that can echo row values', () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: `Key (email)=(${SENTINEL}) already exists.`,
      where: SENTINEL,
      query: SENTINEL,
      parameters: [SENTINEL],
      hint: SENTINEL,
      cause: new Error(SENTINEL),
    });
    expect(JSON.stringify(serializeError(err))).not.toContain(SENTINEL);
    expect(serializeError(err)).toMatchObject({ type: 'Error', code: '23505' });
  });

  it('logs domain errors by code only', () => {
    const s = serializeError(
      new ValidationError('invalid_input', 'Input tidak valid', { issues: [{ path: 'email', message: SENTINEL }] }),
    );
    expect(JSON.stringify(s)).not.toContain(SENTINEL);
    expect(s).toEqual({ type: 'ValidationError', code: 'invalid_input', message: 'Input tidak valid' });
  });

  it('does not stringify values that are not errors', () => {
    const s = serializeError({ note: SENTINEL });
    expect(JSON.stringify(s)).not.toContain(SENTINEL);
    expect(s.type).toBe('NonError');
  });
});
