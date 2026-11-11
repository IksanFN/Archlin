import { FakeClock } from '@archlin/testing/fakes';
import { describe, expect, it } from 'vitest';
import { createFixedWindowLimiter } from './rate-limiter';

const START = new Date('2026-11-11T01:00:00.000Z');

describe('createFixedWindowLimiter', () => {
  it('allows sixty requests and rejects the sixty-first', () => {
    const clock = new FakeClock(START);
    const limiter = createFixedWindowLimiter({ limit: 60, windowMs: 60_000, clock });
    for (let i = 0; i < 60; i++) expect(limiter.take('token-a')).toEqual({ allowed: true });
    const rejected = limiter.take('token-a');
    expect(rejected.allowed).toBe(false);
    if (!rejected.allowed) expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('opens a new window once the old one has passed', () => {
    const clock = new FakeClock(START);
    const limiter = createFixedWindowLimiter({ limit: 60, windowMs: 60_000, clock });
    for (let i = 0; i < 61; i++) limiter.take('token-a');
    clock.advance(60_000);
    expect(limiter.take('token-a')).toEqual({ allowed: true });
  });

  it('keeps separate budgets per key', () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000, clock: new FakeClock(START) });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
  });

  it('reports the time left in the current window, rounded up', () => {
    const clock = new FakeClock(START);
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000, clock });
    limiter.take('a');
    clock.advance(30_500);
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });
});
