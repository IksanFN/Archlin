import { PLATFORM_NAMESPACE } from '@archlin/db/migrations';
import type { NamespacedMigrations } from '@archlin/db/migrations';
import { identityMigration } from './202611111200_identity';

// Local names follow `<12-digit timestamp>_<name>`; the outbox migration (Task 10) is registered here too.
export const platformMigrations: NamespacedMigrations = {
  namespace: PLATFORM_NAMESPACE,
  migrations: {
    '202611111200_identity': identityMigration,
  },
};
