import { ForbiddenError, RateLimitedError, systemIds, UnauthorizedError, ValidationError } from '@archlin/kernel';
import type { Clock, Logger, OwnerScope } from '@archlin/kernel';
import type { AuthContext, AuthService } from '@archlin/platform/server';
import type { z } from 'zod';
import { getContainer } from './container';
import { SESSION_COOKIE } from './cookie-names';
import { AppError, toAppError } from './errors';
import { MAX_BODY_BYTES } from './limits';
import { createFixedWindowLimiter } from './rate-limiter';
import type { FixedWindowLimiter } from './rate-limiter';

// Plain HTTP endpoints (spec 12.1). Server functions go through fn.ts; this file covers the few routes that must be
// ordinary requests: /health and the bearer-token API.

export interface RouteDeps {
  auth: Pick<AuthService, 'authenticate' | 'authenticateApiToken'>;
  clock: Clock;
  logger: Logger;
}

interface RouteContext {
  request: Request;
  // The request middleware stores requestId here; kept loose so wrappers stay testable without the Start runtime.
  context?: unknown;
}

export type RouteHandler = (ctx: RouteContext) => Promise<Response>;
export type ApiScope = 'capture:write';

const TOKEN_REQUESTS_PER_MINUTE = 60;

function requestIdOf(context: unknown): string | null {
  if (typeof context === 'object' && context !== null && 'requestId' in context && typeof context.requestId === 'string') {
    return context.requestId;
  }
  return null;
}

function retryAfterOf(details: unknown): number | null {
  if (typeof details === 'object' && details !== null && 'retryAfterSeconds' in details) {
    return typeof details.retryAfterSeconds === 'number' ? details.retryAfterSeconds : null;
  }
  return null;
}

function errorResponse(error: AppError, requestId: string, challenge: string | null): Response {
  const headers = new Headers({ 'cache-control': 'no-store', 'x-request-id': requestId });
  const retryAfter = error.status === 429 ? retryAfterOf(error.details) : null;
  if (retryAfter !== null) headers.set('retry-after', String(retryAfter));
  if (error.status === 401 && challenge !== null) headers.set('www-authenticate', challenge);
  return Response.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: error.status, headers });
}

// One place maps every failure to the documented error body, so a handler can simply throw.
async function respond(
  ctx: RouteContext,
  deps: RouteDeps | undefined,
  options: { challenge?: string },
  run: (deps: RouteDeps) => Promise<Response>,
): Promise<Response> {
  const resolved = deps ?? getContainer();
  const requestId = requestIdOf(ctx.context) ?? systemIds.uuidv7();
  try {
    return await run(resolved);
  } catch (err) {
    const appError = toAppError(err, requestId);
    if (appError.status >= 500) resolved.logger.error({ requestId, err }, 'route handler failed');
    return errorResponse(appError, requestId, options.challenge ?? null);
  }
}

function tooLarge(): AppError {
  return new AppError({ code: 'payload_too_large', message: 'Permintaan terlalu besar', status: 413 });
}

// Reads at most MAX_BODY_BYTES even when the client sent no content-length (chunked bodies).
async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ValidationError('invalid_input', 'Body bukan JSON yang valid', {
      issues: [{ path: '', message: 'invalid_json' }],
    });
  }
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

const readsQuery = (request: Request): boolean => request.method === 'GET' || request.method === 'HEAD';

export function publicRoute(handler: (request: Request) => Promise<Response>, deps?: RouteDeps): RouteHandler {
  return (ctx) => respond(ctx, deps, {}, () => handler(ctx.request));
}

export function authedRoute<T>(
  schema: z.ZodType<T>,
  handler: (args: { request: Request; auth: AuthContext; input: T }) => Promise<Response>,
  deps?: RouteDeps,
): RouteHandler {
  return (ctx) =>
    respond(ctx, deps, {}, async (resolved) => {
      const token = readCookie(ctx.request, SESSION_COOKIE);
      if (token === null) throw new UnauthorizedError();
      const auth = await resolved.auth.authenticate(token);
      const raw = readsQuery(ctx.request) ? Object.fromEntries(new URL(ctx.request.url).searchParams) : await readJsonBody(ctx.request);
      return handler({ request: ctx.request, auth, input: schema.parse(raw) });
    });
}

export function tokenRoute<T>(
  scope: ApiScope,
  schema: z.ZodType<T>,
  handler: (args: { request: Request; owner: OwnerScope; tokenId: string; input: T }) => Promise<Response>,
  deps?: RouteDeps,
): RouteHandler {
  let limiter: FixedWindowLimiter | undefined;

  return (ctx) =>
    respond(ctx, deps, { challenge: 'Bearer' }, async (resolved) => {
      const token = /^Bearer\s+(\S+)$/i.exec(ctx.request.headers.get('authorization') ?? '')?.[1];
      if (token === undefined) throw new UnauthorizedError();
      const api = await resolved.auth.authenticateApiToken(token);
      if (!api.scopes.includes(scope)) {
        throw new ForbiddenError('insufficient_scope', 'Token tidak memiliki izin untuk aksi ini');
      }

      limiter ??= createFixedWindowLimiter({ limit: TOKEN_REQUESTS_PER_MINUTE, windowMs: 60_000, clock: resolved.clock });
      const decision = limiter.take(api.tokenId);
      if (!decision.allowed) {
        throw new RateLimitedError('rate_limited', 'Terlalu banyak permintaan', { retryAfterSeconds: decision.retryAfterSeconds });
      }

      const input = schema.parse(await readJsonBody(ctx.request));
      return handler({ request: ctx.request, owner: api.owner, tokenId: api.tokenId, input });
    });
}
