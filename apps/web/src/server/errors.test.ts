import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from '@archlin/kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, appErrorAdapter, toAppError } from './errors';

describe('toAppError', () => {
  it.each([
    [new NotFoundError('gone', 'x'), 404],
    [new ValidationError('bad', 'x'), 422],
    [new ConflictError('dup', 'x'), 409],
    [new ForbiddenError('reauth_required', 'x'), 403],
    [new UnauthorizedError(), 401],
    [new RateLimitedError('slow', 'x', { retryAfterSeconds: 1 }), 429],
  ])('maps %o to %i', (error, status) => {
    const mapped = toAppError(error, 'req-1');
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.status).toBe(status);
    expect(mapped.code).toBe(error.code);
    expect(mapped.details).toEqual(error.details ?? null);
  });

  it('maps a zod error to 422 invalid_input with dotted paths', () => {
    const result = z.strictObject({ a: z.strictObject({ b: z.string() }) }).safeParse({ a: { b: 1 } });
    if (result.success) throw new Error('expected a validation failure');
    const mapped = toAppError(result.error, null);
    expect(mapped).toMatchObject({ status: 422, code: 'invalid_input' });
    expect(mapped.details).toEqual({ issues: [{ path: 'a.b', message: expect.any(String) }] });
  });

  it('hides unexpected errors behind internal with a request id', () => {
    const mapped = toAppError(new Error('connection to 10.0.0.5 refused, password=hunter2'), 'req-9');
    expect(mapped).toMatchObject({ status: 500, code: 'internal', message: 'Terjadi kesalahan', requestId: 'req-9', details: null });
    expect(JSON.stringify(mapped)).not.toContain('hunter2');
  });

  it('returns an existing AppError unchanged', () => {
    const original = new AppError({ code: 'x', message: 'm', status: 418, requestId: null });
    expect(toAppError(original, 'other')).toBe(original);
  });
});

describe('appErrorAdapter', () => {
  it('recognizes only AppError instances', () => {
    expect(appErrorAdapter.test(new AppError({ code: 'x', message: 'm', status: 400, requestId: null }))).toBe(true);
    expect(appErrorAdapter.test(new Error('x'))).toBe(false);
    expect(appErrorAdapter.test({ code: 'x' })).toBe(false);
  });

  it('round-trips through the serialization adapter', () => {
    const original = new AppError({
      code: 'invalid_input',
      message: 'Input tidak valid',
      status: 422,
      details: { issues: [{ path: 'email', message: 'bad' }] },
      requestId: 'req-3',
    });
    const restored = appErrorAdapter.fromSerializable(appErrorAdapter.toSerializable(original));
    expect(restored).toBeInstanceOf(AppError);
    expect(restored).toMatchObject({ code: 'invalid_input', message: 'Input tidak valid', status: 422, requestId: 'req-3' });
    expect(restored.details).toEqual(original.details);
  });

  it('round-trips an error without details', () => {
    const restored = appErrorAdapter.fromSerializable(
      appErrorAdapter.toSerializable(new AppError({ code: 'unauthenticated', message: 'm', status: 401, requestId: null })),
    );
    expect(restored.details).toBeNull();
    expect(restored.requestId).toBeNull();
  });
});
