import { readSchemaStatus } from '@archlin/db/migrations';
import type { Clock, Logger, ModuleRegistry, OwnerUnitOfWork } from '@archlin/kernel';
import { createDeliveryConsumer, createOutboxRelay } from '@archlin/platform/server';
import type { Kysely } from 'kysely';
import type { WorkerQueue } from './pg-boss-queue';

export interface WorkerRuntimeDeps {
  db: Kysely<unknown>;
  uow: OwnerUnitOfWork;
  registry: ModuleRegistry;
  queue: WorkerQueue;
  clock: Clock;
  logger: Logger;
  expectedMigrations: readonly string[];
  pollIntervalMs?: number;
  sweepIntervalMs?: number;
  schemaPollMs?: number;
}

export interface WorkerRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class SchemaMismatchError extends Error {
  override readonly name = 'SchemaMismatchError';
}

export function createWorkerRuntime(deps: WorkerRuntimeDeps): WorkerRuntime {
  const { db, uow, registry, queue, clock, logger, expectedMigrations } = deps;
  const pollIntervalMs = deps.pollIntervalMs ?? 1000;
  const sweepIntervalMs = deps.sweepIntervalMs ?? 30_000;
  const schemaPollMs = deps.schemaPollMs ?? 5000;

  const relay = createOutboxRelay({ db, uow, queue, clock, logger });
  const consumer = createDeliveryConsumer({ uow, registry, clock, logger });

  const stopping = new AbortController();
  const loops: Promise<void>[] = [];

  // Resolves early when the runtime stops, so a long interval never delays shutdown.
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (stopping.signal.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        stopping.signal.removeEventListener('abort', done);
        resolve();
      }
      stopping.signal.addEventListener('abort', done, { once: true });
    });

  // A loop awaits its own work before sleeping, so a slow tick can never overlap the next one.
  function loop(name: string, intervalMs: number, work: () => Promise<unknown>): Promise<void> {
    return (async () => {
      while (!stopping.signal.aborted) {
        try {
          await work();
        } catch (err) {
          logger.error({ err, loop: name }, 'worker loop iteration failed');
        }
        await sleep(intervalMs);
      }
    })();
  }

  // Never process events against a schema this build does not match: wait while migrations are pending, stop when the
  // database is newer than the code.
  async function waitForSchema(): Promise<void> {
    for (;;) {
      const status = await readSchemaStatus(db, expectedMigrations);
      if (status.status === 'ok') return;
      if (status.status === 'unknown_migrations') {
        throw new SchemaMismatchError(`Database has unknown migrations (${status.unknown.length}); this worker build is older than the schema`);
      }
      if (stopping.signal.aborted) return;
      logger.warn({ pending: status.missing.length }, 'waiting for pending migrations');
      await sleep(schemaPollMs);
    }
  }

  return {
    async start() {
      await waitForSchema();
      if (stopping.signal.aborted) return;
      await queue.work((data) => consumer.handle(data));
      loops.push(loop('relay', pollIntervalMs, () => relay.tick()), loop('sweep', sweepIntervalMs, () => relay.sweep()));
      logger.info({}, 'worker started');
    },

    async stop() {
      stopping.abort();
      await Promise.all(loops);
      await queue.stop();
      logger.info({}, 'worker stopped');
    },
  };
}
