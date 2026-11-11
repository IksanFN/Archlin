import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from './errors';

describe('domain errors', () => {
  it.each([
    ['NotFoundError', new NotFoundError('page_missing', 'Halaman tidak ditemukan'), 'not_found'],
    ['ValidationError', new ValidationError('invalid_input', 'Input tidak valid'), 'validation'],
    ['ConflictError', new ConflictError('already_set_up', 'Sudah diatur'), 'conflict'],
    ['ForbiddenError', new ForbiddenError('forbidden', 'Dilarang'), 'forbidden'],
    ['UnauthorizedError', new UnauthorizedError(), 'unauthorized'],
    ['RateLimitedError', new RateLimitedError('too_many', 'Terlalu banyak', { retryAfterSeconds: 30 }), 'rate_limited'],
  ] as const)('%s is a DomainError with kind %s', (name, error, kind) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe(kind);
    expect(error.name).toBe(name);
  });

  it('keeps code, message and details on the base class', () => {
    const error = new ConflictError('stale_revision', 'Revisi usang', { currentVersion: 4 });
    expect(error.code).toBe('stale_revision');
    expect(error.message).toBe('Revisi usang');
    expect(error.details).toEqual({ currentVersion: 4 });
  });

  it('defaults validation details to an empty issue list', () => {
    expect(new ValidationError('invalid_input', 'x').details).toEqual({ issues: [] });
  });

  it('carries per-field issues on ValidationError', () => {
    const error = new ValidationError('invalid_input', 'x', { issues: [{ path: 'email', message: 'wajib' }] });
    expect(error.details.issues).toEqual([{ path: 'email', message: 'wajib' }]);
  });

  it('distinguishes forbidden from reauth_required by code', () => {
    expect(new ForbiddenError('reauth_required', 'x').code).toBe('reauth_required');
  });

  it('defaults UnauthorizedError to the unauthenticated code', () => {
    expect(new UnauthorizedError().code).toBe('unauthenticated');
    expect(new UnauthorizedError('session_expired', 'x').code).toBe('session_expired');
  });

  it('stores retryAfterSeconds on RateLimitedError', () => {
    const error = new RateLimitedError('too_many', 'x', { retryAfterSeconds: 45 });
    expect(error.details.retryAfterSeconds).toBe(45);
  });
});
