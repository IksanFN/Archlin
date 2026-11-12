import { OUTBOX_QUEUE } from '@archlin/platform/server';
import type { DeliveryPointer, JobQueue } from '@archlin/platform/server';
import type { PgBoss } from 'pg-boss';

export interface WorkerQueue extends JobQueue {
  work(handle: (data: unknown) => Promise<unknown>): Promise<void>;
  stop(): Promise<void>;
}

// The worker's single adapter over pg-boss; the in-memory fake in packages/testing is the second implementation of
// JobQueue, which is what keeps this seam honest.
export function createPgBossQueue(boss: PgBoss): WorkerQueue {
  let started = false;

  async function ensureStarted(): Promise<void> {
    if (started) return;
    await boss.start();
    started = true;
  }

  return {
    async send(pointer: DeliveryPointer) {
      await ensureStarted();
      // The queue exists from the migrate step; a null id would mean pg-boss dropped the job.
      const id = await boss.send(OUTBOX_QUEUE, pointer);
      if (id === null) throw new Error('pg-boss did not accept the job');
    },

    async work(handle) {
      await ensureStarted();
      // Batch size is one by default, so a throwing handler fails exactly the job that threw and pg-boss retries it.
      await boss.work<DeliveryPointer>(OUTBOX_QUEUE, async (jobs) => {
        for (const job of jobs) await handle(job.data);
      });
    },

    async stop() {
      if (!started) return;
      started = false;
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}
