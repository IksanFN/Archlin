import { DomainError } from '@archlin/kernel';
import type { DomainErrorKind } from '@archlin/kernel';
import { createSerializationAdapter } from '@tanstack/react-router';
import { ZodError } from 'zod';

export interface AppErrorInit {
  code: string;
  message: string;
  status: number;
  details?: unknown;
  requestId?: string | null;
}

// The only error shape that crosses the server function boundary to the browser.
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor({ code, message, status, details = null, requestId = null }: AppErrorInit) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

interface SerializedAppError {
  code: string;
  message: string;
  status: number;
  // The adapter only accepts statically serializable types, so free-form details travel as JSON text.
  detailsJson: string | null;
  requestId: string | null;
}

export const appErrorAdapter = createSerializationAdapter({
  key: 'archlin.app-error',
  test: (value): value is AppError => value instanceof AppError,
  toSerializable: (error): SerializedAppError => ({
    code: error.code,
    message: error.message,
    status: error.status,
    detailsJson: error.details === null || error.details === undefined ? null : JSON.stringify(error.details),
    requestId: error.requestId,
  }),
  fromSerializable: (value) =>
    new AppError({
      code: value.code,
      message: value.message,
      status: value.status,
      details: value.detailsJson === null ? null : (JSON.parse(value.detailsJson) as unknown),
      requestId: value.requestId,
    }),
});

const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  not_found: 404,
  validation: 422,
  conflict: 409,
  forbidden: 403,
  unauthorized: 401,
  rate_limited: 429,
};

export function toAppError(err: unknown, requestId: string | null): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof DomainError) {
    return new AppError({
      code: err.code,
      message: err.message,
      status: STATUS_BY_KIND[err.kind],
      details: err.details ?? null,
      requestId,
    });
  }
  if (err instanceof ZodError) {
    return new AppError({
      code: 'invalid_input',
      message: 'Input tidak valid',
      status: 422,
      details: { issues: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) },
      requestId,
    });
  }
  // Anything else may carry connection strings or SQL text, so it is replaced with a generic message.
  return new AppError({ code: 'internal', message: 'Terjadi kesalahan', status: 500, requestId });
}
