import type { OwnerId, WriteTx } from '@archlin/kernel';
import type { Transaction } from 'kysely';

// Internal to @archlin/db (not in package exports): the runtime creates handles, `scoped` reads them.
// Handles stay opaque objects with no properties, so module code cannot reach the connection or the owner except
// through sqlFor/ownerOf. The state lives here, keyed by the handle.

interface TransactionState {
  readonly trx: Transaction<unknown>;
  readonly ownerId: OwnerId;
  open: boolean;
}

const states = new WeakMap<object, TransactionState>();

export class TransactionClosedError extends Error {
  override readonly name = 'TransactionClosedError';

  constructor() {
    super('The transaction handle was used after its unit of work finished.');
  }
}

// The only casts in this package: WriteTx/ReadTx are branded interfaces that no plain object can satisfy.
export function openHandle(trx: Transaction<unknown>, ownerId: OwnerId): WriteTx {
  const handle = Object.freeze(Object.create(null) as object);
  states.set(handle, { trx, ownerId, open: true });
  return handle as unknown as WriteTx;
}

export function closeHandle(handle: object): void {
  const state = states.get(handle);
  if (state) state.open = false;
}

export function stateOf(handle: object): TransactionState {
  const state = states.get(handle);
  if (state === undefined) {
    throw new TypeError('Not a transaction handle issued by a unit of work.');
  }
  if (!state.open) {
    throw new TransactionClosedError();
  }
  return state;
}
