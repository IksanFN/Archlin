import {
  changePasswordInputSchema,
  confirmTotpInputSchema,
  reauthInputSchema,
  revokeSessionInputSchema,
  securityEventsInputSchema,
  updateProfileInputSchema,
} from '@archlin/platform/contracts';
import type { SecurityEventSummary, SessionSummary, Viewer } from '@archlin/platform/contracts';
import QRCode from 'qrcode';
import { z } from 'zod';
import { getContainer } from '~/server/container';
import { authedFn, strictInput } from '~/server/fn';
import { getRequestMeta } from '~/server/request-meta';
import { setSessionCookie } from '~/server/session-cookie';

export const viewerFn = authedFn.validator(strictInput(z.strictObject({}))).handler(({ context }): Promise<Viewer> => {
  return getContainer().account.getViewer(context.auth);
});

export const updateProfileFn = authedFn
  .validator(strictInput(updateProfileInputSchema))
  .handler(({ data, context }): Promise<Viewer> => getContainer().account.updateProfile(context.auth, data));

export const reauthFn = authedFn
  .validator(strictInput(reauthInputSchema))
  .handler(({ data, context }): Promise<{ reauthUntil: string }> =>
    getContainer().account.reauthenticate(context.auth, data, getRequestMeta()),
  );

// Password change and TOTP enrollment or removal rotate the session, so the replacement cookie is set here.
export const changePasswordFn = authedFn
  .validator(strictInput(changePasswordInputSchema))
  .handler(async ({ data, context }): Promise<{ status: 'password_changed' }> => {
    setSessionCookie(await getContainer().account.changePassword(context.auth, data, getRequestMeta()));
    return { status: 'password_changed' };
  });

export const beginTotpFn = authedFn
  .validator(strictInput(z.strictObject({})))
  .handler(async ({ context }): Promise<{ secret: string; otpauthUri: string; qrSvg: string }> => {
    const enrollment = await getContainer().account.beginTotpEnrollment(context.auth);
    // Rendered on the server so the secret never goes to a third-party QR service.
    return { ...enrollment, qrSvg: await QRCode.toString(enrollment.otpauthUri, { type: 'svg', margin: 1 }) };
  });

export const confirmTotpFn = authedFn
  .validator(strictInput(confirmTotpInputSchema))
  .handler(async ({ data, context }): Promise<{ recoveryCodes: readonly string[] }> => {
    const { session, recoveryCodes } = await getContainer().account.confirmTotpEnrollment(context.auth, data, getRequestMeta());
    setSessionCookie(session);
    return { recoveryCodes };
  });

export const disableTotpFn = authedFn
  .validator(strictInput(z.strictObject({})))
  .handler(async ({ context }): Promise<{ status: 'totp_disabled' }> => {
    setSessionCookie(await getContainer().account.disableTotp(context.auth, getRequestMeta()));
    return { status: 'totp_disabled' };
  });

export const regenerateRecoveryCodesFn = authedFn
  .validator(strictInput(z.strictObject({})))
  .handler(({ context }): Promise<{ recoveryCodes: readonly string[] }> =>
    getContainer().account.regenerateRecoveryCodes(context.auth, getRequestMeta()),
  );

export const sessionsFn = authedFn
  .validator(strictInput(z.strictObject({})))
  .handler(({ context }): Promise<readonly SessionSummary[]> => getContainer().account.listSessions(context.auth));

export const revokeSessionFn = authedFn
  .validator(strictInput(revokeSessionInputSchema))
  .handler(async ({ data, context }): Promise<{ status: 'revoked' }> => {
    await getContainer().account.revokeSession(context.auth, data, getRequestMeta());
    return { status: 'revoked' };
  });

export const revokeOtherSessionsFn = authedFn
  .validator(strictInput(z.strictObject({})))
  .handler(({ context }): Promise<{ revoked: number }> => getContainer().account.revokeOtherSessions(context.auth, getRequestMeta()));

export const securityEventsFn = authedFn
  .validator(strictInput(securityEventsInputSchema))
  .handler(({ data, context }): Promise<readonly SecurityEventSummary[]> =>
    getContainer().account.listSecurityEvents(context.auth, data),
  );
