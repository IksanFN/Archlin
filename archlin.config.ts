import type { NamespacedMigrations } from '@archlin/db/migrations';
import type { ModuleDraft, ModuleServerDeps } from '@archlin/kernel';
import { knowledgeMigrations } from '@archlin/modules-knowledge/migrations';
import { createKnowledgeModule } from '@archlin/modules-knowledge/server';
import { platformMigrations } from '@archlin/platform/migrations';

export interface ArchlinModuleEntry {
  createServer(deps: ModuleServerDeps): ModuleDraft;
  readonly migrations: NamespacedMigrations;
}

export const modules: readonly ArchlinModuleEntry[] = [
  { createServer: createKnowledgeModule, migrations: knowledgeMigrations },
];

export function moduleDrafts(deps: ModuleServerDeps): ModuleDraft[] {
  return modules.map((m) => m.createServer(deps));
}

// Platform first, then modules in the order they are listed above.
export function migrationSets(): readonly NamespacedMigrations[] {
  return [platformMigrations, ...modules.map((m) => m.migrations)];
}
