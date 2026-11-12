import { sqlFor } from '@archlin/db/scoped';
import { ConflictError } from '@archlin/kernel';
import { createAuthHarness, TEST_META, VALID_SETUP } from '@archlin/testing/auth';
import type { AuthHarness } from '@archlin/testing/auth';
import { sql } from 'kysely';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SESSION_COOKIE } from './cookie-names';
import type { RouteDeps } from './route-wrappers';
import { authedRoute, publicRoute, tokenRoute } from './route-wrappers';

const URL_BASE = 'http://localhost:3000';
const captureSchema = z.strictObject({ text: z.string().max(100) });

let h: AuthHarness;
let deps: RouteDeps;
let sessionToken: string;
let ownerId: string;

beforeAll(async () => {
  h = await createAuthHarness();
  deps = { auth: h.auth, clock: h.clock, logger: h.deps.logger };
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  const session = await h.auth.setup(VALID_SETUP, TEST_META);
  sessionToken = session.token;
  ownerId = (await h.auth.authenticate(session.token)).scope.ownerId;
});

async function insertApiToken(revoked = false): Promise<{ token: string; tokenId: string }> {
  const token = randomBytes(32).toString('base64url');
  const tokenId = '00000000-0000-7000-8000-0000000000bb';
  const ctx = await h.auth.authenticate(sessionToken);
  const revokedAt = revoked ? h.clock.now() : null;
  await h.uow.write(ctx.scope, (tx) =>
    sql`
      insert into public.api_tokens (id, owner_id, name, token_hash, scopes, revoked_at, created_at)
      values (${tokenId}::uuid, ${ownerId}::uuid, 'shortcut', ${createHash('sha256').update(token).digest('hex')},
              array['capture:write'], ${revokedAt}, ${h.clock.now()})
    `.execute(sqlFor(tx)),
  );
  return { token, tokenId };
}

const post = (body: BodyInit | null, headers: Record<string, string> = {}): Request =>
  new Request(`${URL_BASE}/api/capture`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const errorBody = async (response: Response): Promise<{ error: { code: string; message: string; details: unknown } }> =>
  (await response.json()) as { error: { code: string; message: string; details: unknown } };

describe('tokenRoute', () => {
  const callRoute = (request: Request, routeDeps: RouteDeps = deps) =>
    tokenRoute(
      'capture:write',
      captureSchema,
      async ({ input, owner, tokenId }) => Response.json({ text: input.text, ownerId: owner.ownerId, tokenId }),
      routeDeps,
    )({ request });

  it('tokenRoute returns 401 without a bearer token', async () => {
    const response = await callRoute(post(JSON.stringify({ text: 'hi' })));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect((await errorBody(response)).error.code).toBe('unauthenticated');
  });

  it('rejects an authorization header that is not a bearer token', async () => {
    const response = await callRoute(post('{}', { authorization: 'Basic dXNlcjpwYXNz' }));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('tokenRoute returns 401 for a revoked token', async () => {
    const { token } = await insertApiToken(true);
    const response = await callRoute(post(JSON.stringify({ text: 'hi' }), bearer(token)));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('tokenRoute returns 401 for an unknown token', async () => {
    const response = await callRoute(post(JSON.stringify({ text: 'hi' }), bearer('x'.repeat(43))));
    expect(response.status).toBe(401);
  });

  it('tokenRoute returns 422 for unknown keys in the body', async () => {
    const { token } = await insertApiToken();
    const response = await callRoute(post(JSON.stringify({ text: 'hi', extra: 1 }), bearer(token)));
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error).toMatchObject({ code: 'invalid_input', details: { issues: expect.any(Array) } });
  });

  it('returns 422 for a body that is not json', async () => {
    const { token } = await insertApiToken();
    const response = await callRoute(post('{not json', bearer(token)));
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.details).toEqual({ issues: [{ path: '', message: 'invalid_json' }] });
  });

  it('returns 413 for a body over one megabyte', async () => {
    const { token } = await insertApiToken();
    const response = await callRoute(post(JSON.stringify({ text: 'a'.repeat(1_048_577) }), bearer(token)));
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe('payload_too_large');
  });

  it('returns 403 when the token lacks the required scope', async () => {
    const scoped = { ...deps, auth: { ...h.auth, authenticateApiToken: async (token: string) => ({ ...(await h.auth.authenticateApiToken(token)), scopes: [] }) } };
    const { token } = await insertApiToken();
    const response = await callRoute(post(JSON.stringify({ text: 'hi' }), bearer(token)), scoped);
    expect(response.status).toBe(403);
    expect((await errorBody(response)).error.code).toBe('insufficient_scope');
  });

  it('tokenRoute returns 429 after sixty requests in a minute', async () => {
    const { token } = await insertApiToken();
    const handler = tokenRoute('capture:write', captureSchema, async () => new Response(null, { status: 204 }), deps);
    for (let i = 0; i < 60; i++) {
      expect((await handler({ request: post(JSON.stringify({ text: 'hi' }), bearer(token)) })).status).toBe(204);
    }
    const limited = await handler({ request: post(JSON.stringify({ text: 'hi' }), bearer(token)) });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await errorBody(limited)).error.code).toBe('rate_limited');

    h.clock.advance(60_000);
    expect((await handler({ request: post(JSON.stringify({ text: 'hi' }), bearer(token)) })).status).toBe(204);
  });

  it('tokenRoute passes the token owner scope to the handler', async () => {
    const { token, tokenId } = await insertApiToken();
    const response = await callRoute(post(JSON.stringify({ text: 'hello' }), bearer(token)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: 'hello', ownerId, tokenId });
  });
});

describe('authedRoute', () => {
  const call = (request: Request) =>
    authedRoute(
      z.strictObject({ note: z.string() }),
      async ({ auth, input }) => Response.json({ ownerId: auth.scope.ownerId, note: input.note }),
      deps,
    )({ request });
  const cookie = (value: string) => ({ cookie: `other=1; ${SESSION_COOKIE}=${value}` });

  it('authedRoute returns 401 without a session cookie', async () => {
    const response = await call(post(JSON.stringify({ note: 'x' })));
    expect(response.status).toBe(401);
    expect((await errorBody(response)).error.code).toBe('unauthenticated');
  });

  it('returns 401 for a session cookie that does not resolve', async () => {
    expect((await call(post(JSON.stringify({ note: 'x' }), cookie('x'.repeat(43))))).status).toBe(401);
  });

  it('passes the session owner and parsed input to the handler', async () => {
    const response = await call(post(JSON.stringify({ note: 'x' }), cookie(sessionToken)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ownerId, note: 'x' });
  });

  it('returns 422 for unknown keys', async () => {
    const response = await call(post(JSON.stringify({ note: 'x', extra: true }), cookie(sessionToken)));
    expect(response.status).toBe(422);
  });

  it('reads input from the query string for GET requests', async () => {
    const request = new Request(`${URL_BASE}/x?note=dari-query`, { method: 'GET', headers: cookie(sessionToken) });
    const response = await call(request);
    expect(await response.json()).toEqual({ ownerId, note: 'dari-query' });
  });
});

describe('publicRoute', () => {
  it('returns the handler response untouched', async () => {
    const response = await publicRoute(async () => new Response('ok', { status: 201 }), deps)({ request: new Request(`${URL_BASE}/health`) });
    expect(response.status).toBe(201);
  });

  it('maps a domain error to its status and the documented body', async () => {
    const response = await publicRoute(async () => {
      throw new ConflictError('already_set_up', 'Akun sudah dibuat');
    }, deps)({ request: new Request(`${URL_BASE}/x`) });
    expect(response.status).toBe(409);
    expect(await errorBody(response)).toEqual({ error: { code: 'already_set_up', message: 'Akun sudah dibuat', details: null } });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('hides an unexpected error behind a generic 500 and logs it', async () => {
    h.logs.clear();
    const response = await publicRoute(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
    }, deps)({ request: new Request(`${URL_BASE}/x`) });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await errorBody(response))).not.toContain('hunter2');
    expect(h.logs.lines().length).toBeGreaterThan(0);
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
