import type { OwnerScope } from './uow';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only trusted composition code (platform, db, testing, apps) may import this subpath;
// ESLint forbids it inside packages/modules. The value is deliberately left out of the error message.
export function issueOwnerScope(ownerId: string): OwnerScope {
  if (!UUID.test(ownerId)) {
    throw new TypeError('ownerId must be a UUID');
  }
  // The only cast in the kernel: OwnerScope is branded, so no other code path can mint one.
  return Object.freeze({ ownerId }) as unknown as OwnerScope;
}
