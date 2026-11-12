export { TREE_LOCK_CLASS, lockOwnerTree } from './lock';
export type {
  EntitiesDatabase,
  EntitiesTable,
  EntityKindsTable,
  EntityTagsTable,
  SpacesTable,
  TagsTable,
} from './schema';
export { nextFreeSlug, slugCandidate } from './slug';
export { createSpaceService } from './space-service';
export type { SpaceService } from './space-service';
