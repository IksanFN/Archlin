import { PLATFORM_NAMESPACE } from '@archlin/db/migrations';
import type { NamespacedMigrations } from '@archlin/db/migrations';
import { identityMigration } from './202611111200_identity';
import { outboxMigration } from './202611111210_outbox';

// Local names follow `<12-digit timestamp>_<name>`.
export const platformMigrations: NamespacedMigrations = {
  namespace: PLATFORM_NAMESPACE,
  migrations: {
    '202611111200_identity': identityMigration,
    '202611111210_outbox': outboxMigration,
  },
};
