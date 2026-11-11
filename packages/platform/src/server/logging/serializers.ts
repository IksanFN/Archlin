import { DomainError } from '@archlin/kernel';

export interface SerializedError {
  type: string;
  message: string;
  code?: string;
  stack?: string;
}

// Allowlist, not denylist: pg errors carry `detail`, `where`, `query` and `parameters`, which echo row values
// and statement text (spec 13.4 K7). Nothing is copied except the fields below, and `cause` is never followed.
export function serializeError(err: unknown): SerializedError {
  if (err instanceof DomainError) {
    // `details` can hold field-level messages derived from user input, so only the code identifies the failure.
    return { type: err.name, code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    const serialized: SerializedError = { type: err.name, message: err.message };
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') serialized.code = code;
    if (err.stack !== undefined) serialized.stack = err.stack;
    return serialized;
  }
  // A thrown non-Error may be any value, including user content: describe it without reading it.
  return { type: 'NonError', message: 'A non-error value was thrown' };
}
