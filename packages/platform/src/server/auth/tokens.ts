import { createHash, randomBytes } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

// Only the hash is stored, so a database read never yields a usable token.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
