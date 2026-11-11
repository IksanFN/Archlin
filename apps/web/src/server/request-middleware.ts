import { systemIds } from '@archlin/kernel';
import { createCsrfMiddleware, createMiddleware, createServerOnlyFn } from '@tanstack/react-start';
import { getRequestProtocol, getResponseStatus, setResponseHeader } from '@tanstack/react-start/server';
import { randomBytes } from 'node:crypto';
import { getContainer } from './container';
import { MAX_BODY_BYTES } from './limits';
import { buildSecurityHeaders } from './security-headers';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export const requestContextMiddleware = createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
  const started = performance.now();
  const { env, logger } = getContainer();
  const requestId = systemIds.uuidv7();
  const cspNonce = randomBytes(16).toString('base64');

  const headers = buildSecurityHeaders({
    nonce: cspNonce,
    https: getRequestProtocol() === 'https',
    mode: env.nodeEnv === 'development' ? 'vite-dev' : 'strict',
  });
  for (const [name, value] of Object.entries(headers)) setResponseHeader(name, value);

  const result = await next({ context: { requestId, cspNonce } });

  // Pathname only: query strings can carry search text or tokens (spec 13.4 K7).
  logger.info({
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    status: getResponseStatus(),
    durationMs: Math.round(performance.now() - started),
  });
  return result;
});

export const bodyLimitMiddleware = createMiddleware({ type: 'request' }).server(({ request, next }) => {
  if (!SAFE_METHODS.includes(request.method) && Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  return next();
});

// Bearer API requests carry no ambient credentials, so a forged cross-site request cannot authenticate.
function isBearerApiRequest(request: Request): boolean {
  return new URL(request.url).pathname.startsWith('/api/') && (request.headers.get('authorization') ?? '').startsWith('Bearer ');
}

// Server-only so the client bundle of start.ts does not pull the container (and the database driver) in.
const isPublicOrigin = createServerOnlyFn((value: string) => value === getContainer().env.publicOrigin);

export const csrfMiddleware = createCsrfMiddleware({
  filter: ({ request }) => !SAFE_METHODS.includes(request.method) && !isBearerApiRequest(request),
  origin: (value) => isPublicOrigin(value),
});
