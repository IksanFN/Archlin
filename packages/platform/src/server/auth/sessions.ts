import type { Clock, Ids, OwnerScope, WriteTx } from '@archlin/kernel';
import { ownerOf, sqlFor } from '@archlin/db/scoped';
import { sql } from 'kysely';
import { SESSION_ABSOLUTE_MS } from './policy';
import { generateToken, hashToken } from './tokens';

export interface RequestMeta {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface PendingChallenge {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface AuthContext {
  readonly scope: OwnerScope;
  readonly sessionPublicId: string;
  readonly reauthUntil: Date | null;
}

export interface ApiTokenContext {
  readonly owner: OwnerScope;
  readonly tokenId: string;
  readonly scopes: readonly string[];
}

const USER_AGENT_MAX_CHARS = 512;

// The column limit counts characters, so cut by code point; slicing UTF-16 units could leave a lone surrogate.
export function truncateUserAgent(userAgent: string | null): string | null {
  if (userAgent === null) return null;
  const points = [...userAgent];
  return points.length <= USER_AGENT_MAX_CHARS ? userAgent : points.slice(0, USER_AGENT_MAX_CHARS).join('');
}

// Inserts a session for the transaction's owner. Callers add their own security event in the same transaction.
export async function insertSession(
  tx: WriteTx,
  deps: { clock: Clock; ids: Ids },
  meta: RequestMeta,
): Promise<IssuedSession & { readonly publicId: string }> {
  const now = deps.clock.now();
  const token = generateToken();
  const publicId = deps.ids.uuidv7();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await sql`
    insert into public.sessions (id, public_id, user_id, created_at, expires_at, last_seen_at, user_agent)
    values (${hashToken(token)}, ${publicId}::uuid, ${ownerOf(tx)}::uuid, ${now}, ${expiresAt}, ${now}, ${truncateUserAgent(meta.userAgent)})
  `.execute(sqlFor(tx));
  return { token, expiresAt, publicId };
}
