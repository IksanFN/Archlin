import { describe, expect, it } from 'vitest';
import { loginInputSchema, setupInputSchema, totpLoginInputSchema } from './index';

const setup = {
  setupToken: 'token',
  displayName: '  Andra  ',
  email: 'andra@archlin.id',
  password: 'kata-sandi-aman-123',
  timezone: 'Asia/Jakarta',
};

describe('auth input schemas', () => {
  it('trims the display name and rejects unknown keys', () => {
    expect(setupInputSchema.parse(setup).displayName).toBe('Andra');
    expect(setupInputSchema.safeParse({ ...setup, isAdmin: true }).success).toBe(false);
    expect(loginInputSchema.safeParse({ email: 'a', password: 'b', remember: true }).success).toBe(false);
  });

  it('rejects an invalid email and an empty display name at setup', () => {
    expect(setupInputSchema.safeParse({ ...setup, email: 'bukan-email' }).success).toBe(false);
    expect(setupInputSchema.safeParse({ ...setup, displayName: '   ' }).success).toBe(false);
  });

  it('accepts either a totp code or a recovery code, never both', () => {
    expect(totpLoginInputSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(totpLoginInputSchema.safeParse({ recoveryCode: 'ABCD-EFGH-JKMN-PQR0' }).success).toBe(true);
    expect(totpLoginInputSchema.safeParse({ code: '123456', recoveryCode: 'ABCD-EFGH-JKMN-PQR0' }).success).toBe(false);
    expect(totpLoginInputSchema.safeParse({}).success).toBe(false);
  });
});
