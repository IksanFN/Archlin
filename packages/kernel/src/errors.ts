export type DomainErrorKind =
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'forbidden'
  | 'unauthorized'
  | 'rate_limited';

// Use cases throw only DomainError subclasses; web adapters map `kind` to a transport status (spec 12.1).
// `name` is set explicitly on each subclass because bundlers may mangle class names.
export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends DomainError {
  readonly kind = 'not_found';
  override readonly name = 'NotFoundError';
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ValidationDetails {
  readonly issues: readonly ValidationIssue[];
}

export class ValidationError extends DomainError {
  readonly kind = 'validation';
  override readonly name = 'ValidationError';
  declare readonly details: ValidationDetails;

  constructor(code: string, message: string, details: ValidationDetails = { issues: [] }) {
    super(code, message, details);
  }
}

export class ConflictError extends DomainError {
  readonly kind = 'conflict';
  override readonly name = 'ConflictError';
}

export type ForbiddenCode = 'forbidden' | 'reauth_required' | 'setup_not_configured' | 'invalid_setup_token' | 'insufficient_scope';

export class ForbiddenError extends DomainError {
  readonly kind = 'forbidden';
  override readonly name = 'ForbiddenError';

  constructor(code: ForbiddenCode = 'forbidden', message = 'Akses ditolak', details?: unknown) {
    super(code, message, details);
  }
}

export class UnauthorizedError extends DomainError {
  readonly kind = 'unauthorized';
  override readonly name = 'UnauthorizedError';

  constructor(code = 'unauthenticated', message = 'Autentikasi diperlukan', details?: unknown) {
    super(code, message, details);
  }
}

export interface RateLimitedDetails {
  readonly retryAfterSeconds: number;
}

export class RateLimitedError extends DomainError {
  readonly kind = 'rate_limited';
  override readonly name = 'RateLimitedError';
  declare readonly details: RateLimitedDetails;

  constructor(code: string, message: string, { retryAfterSeconds }: RateLimitedDetails) {
    super(code, message, { retryAfterSeconds });
  }
}
