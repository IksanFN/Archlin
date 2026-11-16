import { PLATFORM_NAMESPACE } from '@archlin/db/migrations';
import type { NamespacedMigrations } from '@archlin/db/migrations';
import { identityMigration } from './202611111200_identity';
import { outboxMigration } from './202611111210_outbox';
import { entitiesMigration } from './202611121000_entities';
import { linksMigration } from './202611161000_links';
import { blobsMigration } from './202611161010_blobs';

// Local names follow `<12-digit timestamp>_<name>`.
export const platformMigrations: NamespacedMigrations = {
  namespace: PLATFORM_NAMESPACE,
  migrations: {
    '202611111200_identity': identityMigration,
    '202611111210_outbox': outboxMigration,
    '202611121000_entities': entitiesMigration,
    '202611161000_links': linksMigration,
    '202611161010_blobs': blobsMigration,
  },
};
