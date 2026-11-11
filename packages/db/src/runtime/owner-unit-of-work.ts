import type { OwnerScope, OwnerUnitOfWork, ReadTx, WriteTx } from '@archlin/kernel';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { closeHandle, openHandle } from '../internal/transaction-registry';

type AccessMode = 'read only' | 'read write';

// Every transaction starts by binding `app.owner_id` with set_config(..., is_local = true), so the setting dies with the
// transaction and cannot leak to the next user of a pooled connection. There is deliberately no overload without a
// scope and no fallback to the pool: a query outside a unit of work has no owner and RLS returns nothing.
async function inTransaction<T>(
  db: Kysely<unknown>,
  mode: AccessMode,
  scope: OwnerScope,
  fn: (tx: WriteTx) => Promise<T>,
): Promise<T> {
  return db
    .transaction()
    .setAccessMode(mode)
    .execute(async (trx) => {
      await sql`select set_config('app.owner_id', ${scope.ownerId}, true)`.execute(trx);
      const handle = openHandle(trx, scope.ownerId);
      try {
        return await fn(handle);
      } finally {
        closeHandle(handle);
      }
    });
}

export function createOwnerUnitOfWork(db: Kysely<unknown>): OwnerUnitOfWork {
  return {
    // A read callback receives the same kind of handle; PostgreSQL itself rejects writes in the read only transaction.
    read: <T>(scope: OwnerScope, fn: (tx: ReadTx) => Promise<T>) => inTransaction(db, 'read only', scope, fn),
    write: <T>(scope: OwnerScope, fn: (tx: WriteTx) => Promise<T>) => inTransaction(db, 'read write', scope, fn),
  };
}
