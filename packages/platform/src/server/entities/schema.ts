import type { Generated } from 'kysely';

// pg returns timestamptz as Date; position is the fractional-index string stored with COLLATE "C".

export interface EntityKindsTable {
  kind: string;
  module_id: string;
}

export interface SpacesTable {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  icon: string | null;
  position: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export interface EntitiesTable {
  id: string;
  owner_id: string;
  kind: string;
  space_id: string;
  parent_id: string | null;
  position: string;
  title: string;
  icon: string | null;
  is_starred: Generated<boolean>;
  last_viewed_at: Date | null;
  view_count: Generated<number>;
  revision: Generated<number>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_root_id: string | null;
}

export interface TagsTable {
  id: string;
  owner_id: string;
  name: string;
  color: string | null;
  created_at: Date;
}

export interface EntityTagsTable {
  owner_id: string;
  entity_id: string;
  tag_id: string;
}

export interface EntitiesDatabase {
  entity_kinds: EntityKindsTable;
  spaces: SpacesTable;
  entities: EntitiesTable;
  tags: TagsTable;
  entity_tags: EntityTagsTable;
}
