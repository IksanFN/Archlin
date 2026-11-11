import { UnauthorizedError } from '@archlin/kernel';
import { createMiddleware, createServerFn, getGlobalStartContext } from '@tanstack/react-start';
import { getCookie, setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { ZodError } from 'zod';
import type { z } from 'zod';
import { getContainer } from './container';
import { SESSION_COOKIE } from './cookie-names';
import { toAppError } from './errors';

// The only file that may call createServerFn (spec 13.4 K2). Every server function is built from publicFn or authedFn,
// and the architecture test checks the allowlist of public ones.

const errorMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  try {
    return await next();
  } catch (err) {
    const requestId = getGlobalStartContext()?.requestId ?? null;
    const appError = toAppError(err, requestId);
    setResponseStatus(appError.status);
    const details = appError.details;
    if (appError.status === 429 && typeof details === 'object' && details !== null && 'retryAfterSeconds' in details) {
      setResponseHeader('Retry-After', String(details.retryAfterSeconds));
    }
    if (appError.status >= 500) getContainer().logger.error({ requestId, err }, 'server function failed');
    throw appError;
  }
});

const sessionMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const token = getCookie(SESSION_COOKIE);
  if (!token) throw new UnauthorizedError();
  const auth = await getContainer().auth.authenticate(token);
  return next({ context: { auth } });
});

// POST only, so the CSRF middleware always sees these requests.
export const publicFn = createServerFn({ method: 'POST' }).middleware([errorMiddleware]);
export const authedFn = createServerFn({ method: 'POST' }).middleware([errorMiddleware, sessionMiddleware]);

// Sets the status here as well: validators can run before the error middleware has wrapped the call.
export function strictInput<T>(schema: z.ZodType<T>): (input: unknown) => T {
  return (input) => {
    const parsed = schema.safeParse(input);
    if (parsed.success) return parsed.data;
    const appError = toAppError(new ZodError(parsed.error.issues), getGlobalStartContext()?.requestId ?? null);
    setResponseStatus(appError.status);
    throw appError;
  };
}
