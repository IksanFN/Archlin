import type { RequestMeta } from '@archlin/platform/server';
import { getRequestHeader, getRequestIP } from '@tanstack/react-start/server';

// No X-Forwarded-For: M0 has no trusted proxy, so that header would be attacker-controlled input to the rate limiter.
export function getRequestMeta(): RequestMeta {
  return { ip: getRequestIP() ?? null, userAgent: getRequestHeader('user-agent') ?? null };
}
