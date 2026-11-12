import type { NamespacedMigrations } from '@archlin/db/migrations';
import type { ModuleDraft, ModuleServerDeps } from '@archlin/kernel';
import { platformMigrations } from '@archlin/platform/migrations';

export interface ArchlinModuleEntry {
  createServer(deps: ModuleServerDeps): ModuleDraft;
  readonly migrations: NamespacedMigrations;
}

// Adding a module means adding one entry here (spec 5.6). M0 ships no module.
export const modules: readonly ArchlinModuleEntry[] = [];

export function moduleDrafts(deps: ModuleServerDeps): ModuleDraft[] {
  return modules.map((m) => m.createServer(deps));
}

// Platform first, then modules in the order they are listed above.
export function migrationSets(): readonly NamespacedMigrations[] {
  return [platformMigrations, ...modules.map((m) => m.migrations)];
}
