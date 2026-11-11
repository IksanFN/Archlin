import { createHash, randomInt } from 'node:crypto';
import { RECOVERY_CODE_COUNT } from './policy';

// Crockford base32: no I, L, O or U, so a code read aloud or copied from paper stays unambiguous.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 4;
const GROUP_LENGTH = 4;

export const RECOVERY_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;

function generateCode(): string {
  const groups = Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET.charAt(randomInt(ALPHABET.length))).join(''),
  );
  return groups.join('-');
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateCode());
  return [...codes];
}

export function normalizeRecoveryCode(input: string): string | null {
  const normalized = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replaceAll('O', '0')
    .replaceAll('I', '1')
    .replaceAll('L', '1');
  return RECOVERY_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function hashRecoveryCode(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}
