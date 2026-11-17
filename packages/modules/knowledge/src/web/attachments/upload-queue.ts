import type { AttachmentView } from '@archlin/modules-knowledge/shared';

export interface UploadJob {
  id: string;
  // Sent with every attempt of this file, so an upload whose response was lost is not stored twice.
  uploadId: string;
  file: File;
}

export interface UploadEvents {
  onProgress(fraction: number): void;
  onDone(view: AttachmentView): void;
  onFail(error: unknown): void;
}

export interface UploadQueue {
  enqueue(job: UploadJob, events: UploadEvents): void;
  retry(id: string): void;
  cancel(id: string): void;
}

interface Entry {
  job: UploadJob;
  events: UploadEvents;
  state: 'waiting' | 'running' | 'failed';
  controller: AbortController | null;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function createUploadQueue(options: {
  concurrency: number;
  run(job: UploadJob, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<AttachmentView>;
}): UploadQueue {
  const entries = new Map<string, Entry>();
  let running = 0;

  function start(entry: Entry): void {
    const controller = new AbortController();
    entry.state = 'running';
    entry.controller = controller;
    running += 1;
    options.run(entry.job, entry.events.onProgress, controller.signal).then(
      (view) => {
        finish(entry);
        // A cancelled job can still resolve if the response was already on its way.
        if (entries.get(entry.job.id) !== entry) return;
        entries.delete(entry.job.id);
        entry.events.onDone(view);
      },
      (error: unknown) => {
        finish(entry);
        if (controller.signal.aborted || isAbort(error) || entries.get(entry.job.id) !== entry) return;
        entry.state = 'failed';
        entry.events.onFail(error);
      },
    );
  }

  function finish(entry: Entry): void {
    running -= 1;
    entry.controller = null;
    pump();
  }

  function pump(): void {
    for (const entry of entries.values()) {
      if (running >= options.concurrency) return;
      if (entry.state === 'waiting') start(entry);
    }
  }

  return {
    enqueue(job, events) {
      entries.set(job.id, { job, events, state: 'waiting', controller: null });
      pump();
    },
    retry(id) {
      const entry = entries.get(id);
      if (entry === undefined || entry.state !== 'failed') return;
      entry.state = 'waiting';
      pump();
    },
    cancel(id) {
      const entry = entries.get(id);
      if (entry === undefined) return;
      entries.delete(id);
      entry.controller?.abort();
    },
  };
}
