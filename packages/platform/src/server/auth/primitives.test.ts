import { ValidationError } from '@archlin/kernel';
import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';
import { isSupportedTimezone, normalizeEmail } from './normalize';
import { createPasswordHasher, normalizePassword, validateNewPassword } from './password';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_PATTERN,
} from './recovery-codes';
import { createSecretBox, SecretBoxError } from './secret-box';
import { generateToken, hashToken } from './tokens';
import { createTotp } from './totp';
import { failureDelayMs } from './policy';

const toEpoch = (date: Date): number => Math.floor(date.getTime() / 1000);

describe('password', () => {
  it('verifies a password regardless of unicode normalization form', async () => {
    const hasher = createPasswordHasher();
    const composed = 'kata-sandi-café-123';
    const decomposed = 'kata-sandi-café-123';
    const hash = await hasher.hash(normalizePassword(composed));
    expect(await hasher.verify(hash, normalizePassword(decomposed))).toBe(true);
    expect(await hasher.verify(hash, normalizePassword('kata-sandi-cafe-123'))).toBe(false);
  });

  it('counts password length in code points', () => {
    expect(() => validateNewPassword('😀'.repeat(12))).not.toThrow();
    expect(() => validateNewPassword('a'.repeat(11))).toThrow(ValidationError);
    expect(() => validateNewPassword('a'.repeat(257))).toThrow(ValidationError);
  });

  it('reports which length bound was broken as a field issue', () => {
    const issueOf = (input: string) => {
      try {
        validateNewPassword(input);
      } catch (err) {
        return err instanceof ValidationError ? err.details.issues : undefined;
      }
      return undefined;
    };
    expect(issueOf('short')).toEqual([{ path: 'password', message: 'password_too_short' }]);
    expect(issueOf('a'.repeat(257))).toEqual([{ path: 'password', message: 'password_too_long' }]);
  });

  it('burn resolves false without needing a stored hash', async () => {
    await expect(createPasswordHasher().burn('whatever-password')).resolves.toBe(false);
  });
});

describe('secret box', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('rejects a tampered sealed secret', () => {
    const box = createSecretBox(key);
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => box.open(sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A'))).toThrow(SecretBoxError);
  });

  it('uses a fresh iv for every seal', () => {
    const box = createSecretBox(key);
    expect(box.seal('same')).not.toBe(box.seal('same'));
  });

  it('rejects an unknown format version or malformed input', () => {
    const box = createSecretBox(key);
    expect(() => box.open('v2.a.b.c')).toThrow(SecretBoxError);
    expect(() => box.open('garbage')).toThrow(SecretBoxError);
  });

  it('cannot open a secret sealed with another key', () => {
    const sealed = createSecretBox(key).seal('secret');
    expect(() => createSecretBox(Buffer.alloc(32, 8).toString('base64')).open(sealed)).toThrow(SecretBoxError);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => createSecretBox(Buffer.alloc(31, 1).toString('base64'))).toThrow(SecretBoxError);
    expect(() => createSecretBox(Buffer.alloc(33, 1).toString('base64'))).toThrow(SecretBoxError);
    expect(() => createSecretBox('')).toThrow(SecretBoxError);
  });
});

describe('recovery codes', () => {
  it('generates ten distinct, well-formed recovery codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  });

  it('round-trips a generated code through normalization', () => {
    const [code] = generateRecoveryCodes(1);
    expect(code).toBeDefined();
    const normalized = normalizeRecoveryCode(code ?? '');
    expect(normalized).toBe((code ?? '').replaceAll('-', ''));
    expect(RECOVERY_CODE_PATTERN.test(normalized ?? '')).toBe(true);
  });

  it('normalizes recovery codes typed loosely', () => {
    expect(normalizeRecoveryCode(' abcd-efgh-jkmn-pqr0 ')).toBe('ABCDEFGHJKMNPQR0');
    expect(normalizeRecoveryCode('oooo-iiii-llll-0000')).toBe('0000111111110000');
    expect(normalizeRecoveryCode('short')).toBeNull();
  });

  it('rejects characters outside the alphabet and wrong lengths', () => {
    expect(normalizeRecoveryCode('ABCD-EFGH-JKMN-PQRU')).toBeNull();
    expect(normalizeRecoveryCode('ABCD-EFGH-JKMN-PQR00')).toBeNull();
  });

  it('hashes to a stable sha256 hex digest', () => {
    const hash = hashRecoveryCode('ABCDEFGHJKMNPQR0');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode('ABCDEFGHJKMNPQR0')).toBe(hash);
    expect(hashRecoveryCode('ABCDEFGHJKMNPQR1')).not.toBe(hash);
  });
});

describe('totp', () => {
  const now = new Date('2026-11-11T01:00:10Z');

  it('accepts a totp code with spaces and rejects the same time step twice', async () => {
    const totp = createTotp();
    const secret = totp.generateSecret();
    const code = await generate({ secret, epoch: toEpoch(now) });
    const first = await totp.verify(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now, null);
    expect(first.valid).toBe(true);
    if (!first.valid) return;
    expect((await totp.verify(secret, code, now, first.timeStep)).valid).toBe(false);
  });

  it('accepts the previous time step and rejects one two steps old', async () => {
    const totp = createTotp();
    const secret = totp.generateSecret();
    const previous = await generate({ secret, epoch: toEpoch(now) - 30 });
    const stale = await generate({ secret, epoch: toEpoch(now) - 60 });
    expect((await totp.verify(secret, previous, now, null)).valid).toBe(true);
    expect((await totp.verify(secret, stale, now, null)).valid).toBe(false);
  });

  it('rejects anything that is not six digits without verifying', async () => {
    const totp = createTotp();
    const secret = totp.generateSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5a']) {
      expect((await totp.verify(secret, bad, now, null)).valid).toBe(false);
    }
  });

  it('builds an otpauth uri with the Archlin issuer and the account label', () => {
    const totp = createTotp();
    const uri = totp.uri('JBSWY3DPEHPK3PXP', 'andra@archlin.id');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=Archlin');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(decodeURIComponent(uri)).toContain('andra@archlin.id');
  });
});

describe('tokens', () => {
  it('produces 43-character url-safe tokens and stable hashes', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('normalize', () => {
  it('trims and lowercases email', () => {
    expect(normalizeEmail('  Andra@Archlin.ID ')).toBe('andra@archlin.id');
  });

  it('accepts iana zones and UTC, rejects unknown or empty zones', () => {
    expect(isSupportedTimezone('Asia/Jakarta')).toBe(true);
    expect(isSupportedTimezone('UTC')).toBe(true);
    expect(isSupportedTimezone('Mars/Olympus')).toBe(false);
    expect(isSupportedTimezone('')).toBe(false);
  });
});

describe('failure delay', () => {
  it('doubles from 250 ms and caps at 4000 ms', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(failureDelayMs)).toEqual([250, 500, 1000, 2000, 4000, 4000, 4000]);
  });
});
