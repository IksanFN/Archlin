import type { DeliveryPointer, JobQueue } from '@archlin/platform/server';

export interface InMemoryJobQueue extends JobQueue {
  sent(): readonly DeliveryPointer[];
  // Forgets every job, which is how a test simulates a queue that lost them.
  dropAll(): void;
  failNextSends(count: number): void;
}

export function createInMemoryJobQueue(): InMemoryJobQueue {
  let jobs: DeliveryPointer[] = [];
  let failures = 0;
  return {
    async send(pointer) {
      if (failures > 0) {
        failures -= 1;
        throw new Error('in-memory queue refused the job');
      }
      jobs.push(pointer);
    },
    sent: () => [...jobs],
    dropAll() {
      jobs = [];
      failures = 0;
    },
    failNextSends(count) {
      failures = count;
    },
  };
}
