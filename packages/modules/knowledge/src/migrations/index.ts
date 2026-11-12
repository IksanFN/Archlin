import type { NamespacedMigrations } from '@archlin/db/migrations';
import { knowledgeMigration } from './202611121100_knowledge';

export const knowledgeMigrations: NamespacedMigrations = {
  namespace: 'kb',
  migrations: {
    '202611121100_knowledge': knowledgeMigration,
  },
};
