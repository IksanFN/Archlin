import type { OwnerId, ReadTx } from '@archlin/kernel';
import type { Transaction } from 'kysely';
import { stateOf } from './internal/transaction-registry';

export { TransactionClosedError } from './internal/transaction-registry';

// Entry points for module and platform code that run inside OwnerUnitOfWork.read/write.
// The Kysely transaction is already bound to the scope owner (`app.owner_id`), so RLS filters every statement.
export function sqlFor<DB>(tx: ReadTx): Transaction<DB> {
  // The registry stores Transaction<unknown>; callers choose the table types they query.
  return stateOf(tx).trx as unknown as Transaction<DB>;
}

export function ownerOf(tx: ReadTx): OwnerId {
  return stateOf(tx).ownerId;
}
