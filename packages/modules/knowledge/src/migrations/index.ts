import type { NamespacedMigrations } from '@archlin/db/migrations';
import { knowledgeMigration } from './202611121100_knowledge';
import { noteTypeRevisionMigration } from './202611141000_note_type_revision';

export const knowledgeMigrations: NamespacedMigrations = {
  namespace: 'kb',
  migrations: {
    '202611121100_knowledge': knowledgeMigration,
    '202611141000_note_type_revision': noteTypeRevisionMigration,
  },
};
