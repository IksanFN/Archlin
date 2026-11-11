import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class SecretBoxError extends Error {
  override readonly name = 'SecretBoxError';
}

export interface SecretBox {
  seal(plaintext: string): string;
  open(sealed: string): string;
}

const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// AES-256-GCM for TOTP secrets at rest. The version prefix leaves room to rotate the format.
export function createSecretBox(keyBase64: string): SecretBox {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError('Encryption key must decode to 32 bytes');
  }

  return {
    seal(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
    },
    open(sealed) {
      const [version, iv, tag, ciphertext, ...extra] = sealed.split('.');
      if (version !== VERSION || iv === undefined || tag === undefined || ciphertext === undefined || extra.length > 0) {
        throw new SecretBoxError('Unrecognized sealed secret format');
      }
      const ivBytes = Buffer.from(iv, 'base64url');
      const tagBytes = Buffer.from(tag, 'base64url');
      if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) {
        throw new SecretBoxError('Unrecognized sealed secret format');
      }
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, ivBytes);
        decipher.setAuthTag(tagBytes);
        return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
      } catch (err) {
        throw new SecretBoxError('Sealed secret failed authentication', { cause: err });
      }
    },
  };
}
