import type { IssuedSession, PendingChallenge } from '@archlin/platform/server';
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server';
import { MFA_COOKIE, SESSION_COOKIE } from './cookie-names';

export { MFA_COOKIE, SESSION_COOKIE };

// `secure` stays on even for http://localhost: browsers treat localhost as a secure context and still store the cookie.
const BASE = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

export function setSessionCookie(session: IssuedSession): void {
  setCookie(SESSION_COOKIE, session.token, { ...BASE, expires: session.expiresAt });
}

export function clearSessionCookie(): void {
  deleteCookie(SESSION_COOKIE, BASE);
}

export function setMfaCookie(challenge: PendingChallenge): void {
  setCookie(MFA_COOKIE, challenge.token, { ...BASE, expires: challenge.expiresAt });
}

export function readMfaCookie(): string | null {
  return getCookie(MFA_COOKIE) ?? null;
}

export function clearMfaCookie(): void {
  deleteCookie(MFA_COOKIE, BASE);
}
