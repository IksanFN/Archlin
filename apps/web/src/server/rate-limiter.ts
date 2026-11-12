import type { Clock } from '@archlin/kernel';

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface FixedWindowLimiter {
  take(key: string): RateLimitDecision;
}

interface Window {
  start: number;
  count: number;
}

// In-memory and per process: M0 runs a single web instance, and keys are authenticated token ids, so the map stays small.
export function createFixedWindowLimiter(options: { limit: number; windowMs: number; clock: Clock }): FixedWindowLimiter {
  const { limit, windowMs, clock } = options;
  const windows = new Map<string, Window>();

  return {
    take(key) {
      const now = clock.now().getTime();
      let current = windows.get(key);
      if (!current || now - current.start >= windowMs) {
        current = { start: now, count: 0 };
        windows.set(key, current);
      }
      if (current.count >= limit) {
        return { allowed: false, retryAfterSeconds: Math.ceil((current.start + windowMs - now) / 1000) };
      }
      current.count += 1;
      return { allowed: true };
    },
  };
}
