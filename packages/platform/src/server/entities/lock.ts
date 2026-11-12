import { ownerOf, sqlFor } from '@archlin/db/scoped';
import type { WriteTx } from '@archlin/kernel';
import { sql } from 'kysely';

export const TREE_LOCK_CLASS = 727274502;

// Serialize space/tree writes per owner so two transactions cannot pick the same slug or position.
export async function lockOwnerTree(tx: WriteTx): Promise<void> {
  await sql`select pg_advisory_xact_lock(${TREE_LOCK_CLASS}, hashtext(${ownerOf(tx)}::text))`.execute(sqlFor(tx));
}
