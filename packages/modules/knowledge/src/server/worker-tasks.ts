import type { PeriodicTask, WorkerModuleDeps } from '@archlin/platform/server';
import { pruneVersions } from './retention';

const VERSION_RETENTION_INTERVAL_MS = 21_600_000;

export function createKnowledgeWorkerTasks(deps: WorkerModuleDeps): PeriodicTask[] {
  const { uow, clock, logger } = deps;
  return [
    {
      id: 'kb.versionRetention',
      intervalMs: VERSION_RETENTION_INTERVAL_MS,
      async run(owner) {
        const pruned = await uow.write(owner, (tx) => pruneVersions(tx, clock.now()));
        if (pruned > 0) logger.info({ task: 'kb.versionRetention', pruned });
      },
    },
  ];
}
