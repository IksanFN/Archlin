import type { NamespacedMigrations } from '@archlin/db/migrations';
import type { ModuleDraft, ModuleServerDeps } from '@archlin/kernel';
import { knowledgeMigrations } from '@archlin/modules-knowledge/migrations';
import { createKnowledgeModule, createKnowledgeWorkerTasks } from '@archlin/modules-knowledge/server';
import { platformMigrations } from '@archlin/platform/migrations';
import type { PeriodicTask, WorkerModuleDeps } from '@archlin/platform/server';

export interface ArchlinModuleEntry {
  createServer(deps: ModuleServerDeps): ModuleDraft;
  readonly migrations: NamespacedMigrations;
  createWorkerTasks?(deps: WorkerModuleDeps): readonly PeriodicTask[];
}

export const modules: readonly ArchlinModuleEntry[] = [
  {
    createServer: createKnowledgeModule,
    migrations: knowledgeMigrations,
    createWorkerTasks: createKnowledgeWorkerTasks,
  },
];

export function moduleDrafts(deps: ModuleServerDeps): ModuleDraft[] {
  return modules.map((m) => m.createServer(deps));
}

// Platform first, then modules in the order they are listed above.
export function migrationSets(): readonly NamespacedMigrations[] {
  return [platformMigrations, ...modules.map((m) => m.migrations)];
}

// The worker loops by task id, so two modules sharing one would silently replace each other.
export function collectWorkerTasks(
  entries: readonly Pick<ArchlinModuleEntry, 'createWorkerTasks'>[],
  deps: WorkerModuleDeps,
): PeriodicTask[] {
  const tasks: PeriodicTask[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const task of entry.createWorkerTasks?.(deps) ?? []) {
      if (seen.has(task.id)) throw new Error(`Duplicate periodic task id: ${task.id}`);
      seen.add(task.id);
      tasks.push(task);
    }
  }
  return tasks;
}

export function workerTasks(deps: WorkerModuleDeps): PeriodicTask[] {
  return collectWorkerTasks(modules, deps);
}
