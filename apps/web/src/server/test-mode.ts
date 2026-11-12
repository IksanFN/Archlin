import type { Clock } from '@archlin/kernel';
import { z } from 'zod';
import type { WebContainer } from './container';

export interface ControllableClock extends Clock {
  advance(ms: number): void;
  set(date: Date): void;
}

export function createControllableClock(start: Date): ControllableClock {
  let current = start.getTime();
  return {
    // A fresh Date per call, so a caller cannot move the clock by mutating what it received.
    now: () => new Date(current),
    advance(ms) {
      current += ms;
    },
    set(date) {
      current = date.getTime();
    },
  };
}

const clockBodySchema = z
  .strictObject({
    advanceMs: z.number().int().min(0).max(31_536_000_000).optional(),
    setIso: z.iso.datetime().optional(),
  })
  .refine((body) => Object.values(body).filter((value) => value !== undefined).length === 1);

const json = (body: unknown, status: number): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

// Serves /__test/* for the E2E suite. Everything here is inert unless ARCHLIN_TEST_MODE=1; the boot guard keeps that
// flag out of production (spec 13.4 K8).
export async function handleTestRequest(
  request: Request,
  container: { env: Pick<WebContainer['env'], 'testMode'>; testClock: ControllableClock | null },
): Promise<Response> {
  const { testClock } = container;
  if (!container.env.testMode || testClock === null) return new Response(null, { status: 404 });

  if (new URL(request.url).pathname !== '/__test/clock') return new Response(null, { status: 404 });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: 'invalid_input', message: 'Body bukan JSON yang valid', details: null } }, 422);
  }
  const parsed = clockBodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: { code: 'invalid_input', message: 'Input tidak valid', details: null } }, 422);
  }

  if (parsed.data.advanceMs !== undefined) testClock.advance(parsed.data.advanceMs);
  if (parsed.data.setIso !== undefined) testClock.set(new Date(parsed.data.setIso));
  return json({ now: testClock.now().toISOString() }, 200);
}
