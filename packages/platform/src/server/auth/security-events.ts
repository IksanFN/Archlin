import { ownerOf, sqlFor } from '@archlin/db/scoped';
import type { WriteTx } from '@archlin/kernel';
import { sql } from 'kysely';
import type { SecurityEventName } from '../../contracts';
import { truncateUserAgent } from './sessions';
import type { RequestMeta } from './sessions';

export interface SecurityEventInput {
  readonly event: SecurityEventName;
  readonly meta: RequestMeta;
  readonly now: Date;
  readonly sessionPublicId?: string | null;
  // Counts and ids only: this is an audit trail, not a place for credentials or content.
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export async function recordSecurityEvent(tx: WriteTx, input: SecurityEventInput): Promise<void> {
  await sql`
    insert into public.security_events (owner_id, event, ip, user_agent, session_public_id, metadata, created_at)
    values (
      ${ownerOf(tx)}::uuid, ${input.event}, ${input.meta.ip}::inet, ${truncateUserAgent(input.meta.userAgent)},
      ${input.sessionPublicId ?? null}::uuid, ${JSON.stringify(input.metadata ?? {})}::jsonb, ${input.now}
    )
  `.execute(sqlFor(tx));
}
