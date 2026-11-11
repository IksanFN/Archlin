// Brand symbols are declared, never defined: they exist only in the type system, so a plain object
// cannot satisfy OwnerScope, ReadTx or WriteTx. Handles are created by trusted code (see trusted.ts, packages/db).
declare const ownerScopeBrand: unique symbol;
declare const readTxBrand: unique symbol;
declare const writeTxBrand: unique symbol;

export type OwnerId = string & { readonly __brand: 'OwnerId' };

export interface OwnerScope {
  readonly ownerId: OwnerId;
  readonly [ownerScopeBrand]: true;
}

export interface ReadTx {
  readonly [readTxBrand]: true;
}

export interface WriteTx extends ReadTx {
  readonly [writeTxBrand]: true;
}

export interface OwnerUnitOfWork {
  read<T>(scope: OwnerScope, fn: (tx: ReadTx) => Promise<T>): Promise<T>;
  write<T>(scope: OwnerScope, fn: (tx: WriteTx) => Promise<T>): Promise<T>;
}
