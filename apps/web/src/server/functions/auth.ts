import { UnauthorizedError } from '@archlin/kernel';
import { loginInputSchema, setupInputSchema, totpLoginInputSchema } from '@archlin/platform/contracts';
import type { AuthState, LoginOutcome } from '@archlin/platform/contracts';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { getContainer } from '~/server/container';
import { authedFn, publicFn, strictInput } from '~/server/fn';
import { getRequestMeta } from '~/server/request-meta';
import {
  clearMfaCookie,
  clearSessionCookie,
  readMfaCookie,
  SESSION_COOKIE,
  setMfaCookie,
  setSessionCookie,
} from '~/server/session-cookie';

// Tokens only ever travel in cookies. The bodies below carry a status and nothing else.

export const authStateFn = publicFn.validator(strictInput(z.strictObject({}))).handler(async (): Promise<AuthState> => {
  return getContainer().auth.getAuthState(getCookie(SESSION_COOKIE) ?? null);
});

export const setupFn = publicFn
  .validator(strictInput(setupInputSchema))
  .handler(async ({ data }): Promise<{ status: 'authenticated' }> => {
    const session = await getContainer().auth.setup(data, getRequestMeta());
    setSessionCookie(session);
    return { status: 'authenticated' };
  });

export const loginFn = publicFn.validator(strictInput(loginInputSchema)).handler(async ({ data }): Promise<LoginOutcome> => {
  const result = await getContainer().auth.login(data, getRequestMeta());
  if (result.status === 'totp_required') {
    setMfaCookie(result.challenge);
    return { status: 'totp_required' };
  }
  setSessionCookie(result.session);
  return { status: 'authenticated' };
});

export const loginTotpFn = publicFn
  .validator(strictInput(totpLoginInputSchema))
  .handler(async ({ data }): Promise<{ status: 'authenticated' }> => {
    const challengeToken = readMfaCookie();
    if (challengeToken === null) throw new UnauthorizedError('challenge_expired', 'Sesi verifikasi berakhir. Masuk lagi.');
    // The challenge cookie stays after a wrong code so the user can retry; the database caps it at five attempts.
    const session = await getContainer().auth.completeTotpLogin(challengeToken, data, getRequestMeta());
    clearMfaCookie();
    setSessionCookie(session);
    return { status: 'authenticated' };
  });

export const logoutFn = authedFn
  .validator(strictInput(z.strictObject({})))
  .handler(async ({ context }): Promise<{ status: 'signed_out' }> => {
    await getContainer().auth.logout(context.auth);
    clearSessionCookie();
    return { status: 'signed_out' };
  });
