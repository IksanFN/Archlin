import type { Clock, EventPublisher, Ids, Logger, OwnerScope, OwnerUnitOfWork } from '@archlin/kernel';
import type { TreeService } from '../entities';
import type { BlobService, FileStorage } from '../files';
import type { LinkService } from '../links';

// A job a module asks the worker to repeat. The worker calls run once per owner each interval and isolates failures per owner.
export interface PeriodicTask {
  readonly id: string;
  readonly intervalMs: number;
  run(owner: OwnerScope, signal: AbortSignal): Promise<void>;
}

// What the worker composition root hands to modules so they can build their tasks.
export interface WorkerModuleDeps {
  uow: OwnerUnitOfWork;
  clock: Clock;
  ids: Ids;
  logger: Logger;
  publisher: EventPublisher;
  tree: TreeService;
  links: LinkService;
  files: FileStorage;
  blobs: BlobService;
  // Where the worker bundle keeps its sibling files, so a task can start a bundled child process by name.
  workerAssetUrl(fileName: string): URL;
}
