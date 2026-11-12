import { ValidationError } from '@archlin/kernel';
import { hash, verify } from '@node-rs/argon2';
import { PASSWORD_MAX_CHARS, PASSWORD_MIN_CHARS } from './policy';

// NFC keeps one password valid across keyboards and OSes that compose accents differently.
export function normalizePassword(input: string): string {
  return input.normalize('NFC');
}

export function validateNewPassword(input: string): void {
  const length = [...normalizePassword(input)].length;
  const message =
    length < PASSWORD_MIN_CHARS ? 'password_too_short' : length > PASSWORD_MAX_CHARS ? 'password_too_long' : null;
  if (message !== null) {
    throw new ValidationError('invalid_input', 'Password tidak memenuhi syarat', { issues: [{ path: 'password', message }] });
  }
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  // Spends the time of a real verification so an unknown email is not distinguishable by latency.
  burn(password: string): Promise<false>;
}

// @node-rs/argon2 defaults to argon2id (m=19456 KiB, t=2, p=1).
export function createPasswordHasher(): PasswordHasher {
  let dummyHash: Promise<string> | null = null;

  return {
    hash: (password) => hash(password),
    verify: (stored, password) => verify(stored, password),
    async burn(password) {
      dummyHash ??= hash('archlin-timing-equalizer');
      await verify(await dummyHash, password);
      return false;
    },
  };
}
