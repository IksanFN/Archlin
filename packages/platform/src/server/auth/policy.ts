export const SESSION_IDLE_MS = 7 * 24 * 60 * 60_000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60_000;
export const REAUTH_WINDOW_MS = 10 * 60_000;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_MAX_FAILURES = 5;
export const CHALLENGE_TTL_MS = 5 * 60_000;
export { PASSWORD_MIN_CHARS, RECOVERY_CODE_COUNT } from '../../contracts/auth';
// The maximum bounds argon2 cost per request.
export const PASSWORD_MAX_CHARS = 256;

// `failures` is the number of failed attempts in the window before the current one.
export function failureDelayMs(failures: number): number {
  return Math.min(250 * 2 ** failures, 4000);
}
