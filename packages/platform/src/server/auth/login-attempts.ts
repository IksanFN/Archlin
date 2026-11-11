import { RateLimitedError, UnauthorizedError } from '@archlin/kernel';
import type { Clock, Logger } from '@archlin/kernel';
import type { IdentityGateway } from './identity-gateway';
import { failureDelayMs, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from './policy';
import type { RequestMeta } from './sessions';

export interface LoginAttempts {
  // Returns the failures already in the window so the caller can scale its delay; throws once the limit is reached.
  assertNotLocked(email: string | null, userId: string | null, meta: RequestMeta): Promise<number>;
  failPassword(email: string, userId: string | null, priorFailures: number, meta: RequestMeta): Promise<never>;
}

// Shared by login and re-authentication so both draw on the same per-account and per-ip budget (spec 13.3).
export function createLoginAttempts(deps: {
  gateway: IdentityGateway;
  clock: Clock;
  logger: Logger;
  sleep: (ms: number) => Promise<void>;
}): LoginAttempts {
  const { gateway, clock, logger, sleep } = deps;

  return {
    async assertNotLocked(email, userId, meta) {
      const now = clock.now();
      const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
      const { byEmail, byIp } = await gateway.countRecentFailures(email, meta.ip, since);
      if (byEmail >= LOGIN_MAX_FAILURES || byIp >= LOGIN_MAX_FAILURES) {
        await gateway.recordAttempt({ email, ip: meta.ip, userId, outcome: 'locked', userAgent: meta.userAgent, now });
        logger.warn({ outcome: 'locked', userIdPresent: userId !== null });
        throw new RateLimitedError('too_many_attempts', 'Terlalu banyak percobaan. Coba lagi nanti.', {
          retryAfterSeconds: LOGIN_WINDOW_MS / 1000,
        });
      }
      return Math.max(byEmail, byIp);
    },

    async failPassword(email, userId, priorFailures, meta) {
      await gateway.recordAttempt({
        email,
        ip: meta.ip,
        userId,
        outcome: 'password_failed',
        userAgent: meta.userAgent,
        now: clock.now(),
      });
      logger.info({ outcome: 'login_failed', userIdPresent: userId !== null });
      await sleep(failureDelayMs(priorFailures));
      // One code and message for unknown email and wrong password, so the response never reveals which accounts exist.
      throw new UnauthorizedError('invalid_credentials', 'Email atau password salah');
    },
  };
}
