import { generateSecret, generateURI, verify } from 'otplib';

export type TotpVerification = { valid: true; timeStep: number } | { valid: false };

export interface Totp {
  generateSecret(): string;
  uri(secret: string, accountLabel: string): string;
  verify(secret: string, code: string, now: Date, lastUsedStep: number | null): Promise<TotpVerification>;
}

const ISSUER = 'Archlin';
const SIX_DIGITS = /^\d{6}$/;

export function createTotp(): Totp {
  return {
    generateSecret: () => generateSecret(),
    uri: (secret, accountLabel) => generateURI({ issuer: ISSUER, label: accountLabel, secret }),
    async verify(secret, code, now, lastUsedStep) {
      const token = code.replace(/\s+/g, '');
      if (!SIX_DIGITS.test(token)) return { valid: false };
      const result = await verify({
        secret,
        token,
        epoch: Math.floor(now.getTime() / 1000),
        // One step either side absorbs clock drift between the phone and the server.
        epochTolerance: 30,
        ...(lastUsedStep === null ? {} : { afterTimeStep: lastUsedStep }),
      });
      // The functional verify() is typed as a TOTP-or-HOTP union; only a TOTP result carries timeStep.
      return result.valid && 'timeStep' in result ? { valid: true, timeStep: result.timeStep } : { valid: false };
    },
  };
}
