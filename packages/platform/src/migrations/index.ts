import { PLATFORM_NAMESPACE } from '@archlin/db/migrations';
import type { NamespacedMigrations } from '@archlin/db/migrations';

// Identity (Task 8) and outbox (Task 10) migrations are registered here.
export const platformMigrations: NamespacedMigrations = {
  namespace: PLATFORM_NAMESPACE,
  migrations: {},
};
