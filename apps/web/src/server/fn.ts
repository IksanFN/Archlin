import { UnauthorizedError } from '@archlin/kernel';
import { createIsomorphicFn, createMiddleware, createServerFn, getGlobalStartContext } from '@tanstack/react-start';
import { getCookie, getRequest, setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { ZodError } from 'zod';
import type { z } from 'zod';
import { getContainer } from './container';
import { SESSION_COOKIE } from './cookie-names';
import { toAppError } from './errors';

// The only file that may call createServerFn (spec 13.4 K2). Every server function is built from publicFn or authedFn,
// and the architecture test checks the allowlist of public ones.

// During SSR a route calls server functions in-process; a failure there is handled by the route (a redirect, say), and
// stamping it onto the page response would turn that redirect into a 401 the browser never follows.
function isRpcRequest(): boolean {
  return new URL(getRequest().url).pathname.startsWith('/_serverFn/');
}

function setRpcStatus(status: number): void {
  if (isRpcRequest()) setResponseStatus(status);
}

const errorMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  try {
    return await next();
  } catch (err) {
    const requestId = getGlobalStartContext()?.requestId ?? null;
    const appError = toAppError(err, requestId);
    setRpcStatus(appError.status);
    const details = appError.details;
    if (isRpcRequest() && appError.status === 429 && typeof details === 'object' && details !== null && 'retryAfterSeconds' in details) {
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

// Validators ship in the client bundle too, so the server-only status call lives in an isomorphic function whose
// server arm the compiler strips from the browser build.
const setStatusOnServer = createIsomorphicFn()
  .server((status: number): void => setRpcStatus(status))
  .client((): void => undefined);

// Sets the status here as well: validators can run before the error middleware has wrapped the call.
export function strictInput<T>(schema: z.ZodType<T>): (input: unknown) => T {
  return (input) => {
    const parsed = schema.safeParse(input);
    if (parsed.success) return parsed.data;
    const appError = toAppError(new ZodError(parsed.error.issues), getGlobalStartContext()?.requestId ?? null);
    setStatusOnServer(appError.status);
    throw appError;
  };
}
