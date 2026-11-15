import { sqlFor } from '@archlin/db/scoped';
import type { WriteTx } from '@archlin/kernel';
import { sql } from 'kysely';
import type { KnowledgeDatabase } from './schema';

export const VERSION_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// Past the retention window only the last version of each local day stays; manual and import versions are never pruned.
// RLS scopes both the versions and the timezone lookup to the owner of the transaction.
export async function pruneVersions(tx: WriteTx, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - VERSION_RETENTION_DAYS * DAY_MS);
  const { rows } = await sql<{ id: string }>`
    with tz as (
      select coalesce((select timezone from user_settings limit 1), 'Asia/Jakarta') as name
    ),
    ranked as (
      select v.id, v.reason, v.created_at,
        row_number() over (
          partition by v.entity_id, (v.created_at at time zone (select name from tz))::date
          order by v.created_at desc, v.id desc
        ) as rn
      from kb_page_versions v
    )
    delete from kb_page_versions d
    using ranked r
    where d.id = r.id and r.rn > 1 and r.created_at < ${cutoff} and r.reason not in ('manual', 'import')
    returning d.id
  `.execute(sqlFor<KnowledgeDatabase>(tx));
  return rows.length;
}
