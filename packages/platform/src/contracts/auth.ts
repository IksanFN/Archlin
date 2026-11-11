import { z } from 'zod';

export const setupInputSchema = z.strictObject({
  setupToken: z.string().min(1).max(256),
  displayName: z.string().trim().min(1).max(80),
  email: z.email().max(320),
  password: z.string().min(1).max(1024),
  timezone: z.string().min(1).max(64),
});

export const loginInputSchema = z.strictObject({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
});

// The challenge token comes from the MFA cookie, never from the request body.
export const totpLoginInputSchema = z.union([
  z.strictObject({ code: z.string().min(1).max(16) }),
  z.strictObject({ recoveryCode: z.string().min(1).max(32) }),
]);

export const updateProfileInputSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
  timezone: z.string().min(1).max(64),
});

export const reauthInputSchema = z.strictObject({
  password: z.string().min(1).max(1024),
  totpCode: z.string().max(16).optional(),
});

export const changePasswordInputSchema = z.strictObject({ newPassword: z.string().min(1).max(1024) });
export const confirmTotpInputSchema = z.strictObject({ code: z.string().min(1).max(16) });
export const revokeSessionInputSchema = z.strictObject({ publicId: z.uuid() });
export const securityEventsInputSchema = z.strictObject({ limit: z.number().int().min(1).max(100).default(50) });

export type SetupInput = z.infer<typeof setupInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type TotpLoginInput = z.infer<typeof totpLoginInputSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;
export type ReauthInput = z.infer<typeof reauthInputSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
export type ConfirmTotpInput = z.infer<typeof confirmTotpInputSchema>;
export type RevokeSessionInput = z.infer<typeof revokeSessionInputSchema>;
export type SecurityEventsInput = z.output<typeof securityEventsInputSchema>;

// Closed list: the same names are enforced by the security_events check constraint.
export const SECURITY_EVENT_NAMES = [
  'login.success',
  'login.failed',
  'login.locked',
  'session.revoked',
  'password.changed',
  'totp.enabled',
  'totp.disabled',
  'recovery_code.used',
  'recovery_codes.regenerated',
  'api_token.created',
  'api_token.revoked',
] as const;

export type SecurityEventName = (typeof SECURITY_EVENT_NAMES)[number];

export interface AuthState {
  accountExists: boolean;
  setupConfigured: boolean;
  authenticated: boolean;
}

// Shape sent to the browser: tokens travel only in cookies, never in a response body.
export type LoginOutcome = { status: 'authenticated' } | { status: 'totp_required' };

export interface Viewer {
  displayName: string;
  email: string;
  timezone: string;
  totpEnabled: boolean;
  recoveryCodesRemaining: number;
  passwordChangedAt: string;
}

export interface SessionSummary {
  publicId: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  current: boolean;
}

export interface SecurityEventSummary {
  event: SecurityEventName;
  createdAt: string;
  ip: string | null;
  userAgent: string | null;
}
