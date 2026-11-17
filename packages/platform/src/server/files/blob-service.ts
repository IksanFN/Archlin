import { ownerOf, sqlFor } from '@archlin/db/scoped';
import type { Clock, Logger, ModuleRegistry, OwnerUnitOfWork, WriteTx } from '@archlin/kernel';
import { sql } from 'kysely';
import type { RawBuilder } from 'kysely';
import { blobKey } from '../../contracts';
import type { PeriodicTask } from '../tasks/periodic-task';
import type { FileStorage, StagedFile } from './file-storage';

export const BLOB_LOCK_CLASS = 727274503;
export const BLOB_GC_GRACE_MS = 86_400_000;
const GC_BATCH = 100;
const MAINTENANCE_INTERVAL_MS = 21_600_000;
const SHA256_NAME = /^[0-9a-f]{64}$/;

export interface BlobRef {
  sha256: string;
  size: number;
}

export interface BlobService {
  // Serializes everything that publishes or deletes blob files for this owner until the transaction ends.
  lock(tx: WriteTx): Promise<void>;
  register(tx: WriteTx, staged: StagedFile): Promise<BlobRef>;
  collectGarbage(tx: WriteTx): Promise<{ marked: number; unmarked: number; deleted: number }>;
  sweepOrphanFiles(tx: WriteTx): Promise<number>;
}

export function createBlobService(deps: { registry: ModuleRegistry; files: FileStorage; clock: Clock }): BlobService {
  const { registry, files, clock } = deps;

  // Table and column names come from the registry, which only accepts plain identifiers in the module's namespace.
  const referenced: RawBuilder<boolean> =
    registry.blobReferences.length === 0
      ? sql<boolean>`false`
      : sql<boolean>`${sql.join(
          registry.blobReferences.map(
            (reference) =>
              sql<boolean>`exists (select 1 from ${sql.table(`public.${reference.table}`)} r
                where r.owner_id = b.owner_id and r.${sql.ref(reference.column)} = b.sha256)`,
          ),
          sql` or `,
        )}`;

  async function lock(tx: WriteTx): Promise<void> {
    await sql`select pg_advisory_xact_lock(${BLOB_LOCK_CLASS}, hashtext(${ownerOf(tx)}::text))`.execute(sqlFor(tx));
  }

  const graceCutoff = (): Date => new Date(clock.now().getTime() - BLOB_GC_GRACE_MS);

  return {
    lock,

    async register(tx, staged) {
      const owner = ownerOf(tx);
      await lock(tx);
      // Unmarking here matters: a blob that was marked but not yet deleted is in use again from this transaction on.
      await sql`insert into public.blobs (owner_id, sha256, size, created_at)
                values (${owner}, ${staged.sha256}, ${staged.size}, ${clock.now()})
                on conflict (owner_id, sha256) do update set gc_marked_at = null`.execute(sqlFor(tx));
      // Deletion needs the same lock, so a file that exists here cannot disappear before this transaction commits.
      await files.publish(staged, blobKey(owner, staged.sha256));
      return { sha256: staged.sha256, size: staged.size };
    },

    async collectGarbage(tx) {
      const owner = ownerOf(tx);
      const trx = sqlFor(tx);
      await lock(tx);
      const now = clock.now();
      const cutoff = graceCutoff();

      const unmarked = await sql`update public.blobs b set gc_marked_at = null
                                 where b.gc_marked_at is not null and (${referenced})
                                 returning 1`.execute(trx);
      const marked = await sql`update public.blobs b set gc_marked_at = ${now}
                               where b.gc_marked_at is null and b.created_at < ${cutoff} and not (${referenced})
                               returning 1`.execute(trx);

      const { rows: due } = await sql<{ sha256: string }>`select b.sha256 from public.blobs b
                                                          where b.gc_marked_at < ${cutoff} and not (${referenced})
                                                          order by b.gc_marked_at, b.sha256 limit ${GC_BATCH}`.execute(trx);
      // The file goes first: if the transaction then fails, the row stays unreferenced and the next round finishes the job.
      for (const { sha256 } of due) await files.delete(blobKey(owner, sha256));
      const deleted =
        due.length === 0
          ? 0
          : (
              await sql`delete from public.blobs where sha256 = any(${due.map((row) => row.sha256)}::text[]) returning 1`.execute(
                trx,
              )
            ).rows.length;
      return { marked: marked.rows.length, unmarked: unmarked.rows.length, deleted };
    },

    async sweepOrphanFiles(tx) {
      const owner = ownerOf(tx);
      await lock(tx);
      const { rows } = await sql<{ sha256: string }>`select sha256 from public.blobs`.execute(sqlFor(tx));
      const known = new Set(rows.map((row) => row.sha256));
      const cutoff = graceCutoff();
      const orphans: string[] = [];
      for await (const file of files.list(`blobs/${owner}/`)) {
        const name = file.key.slice(file.key.lastIndexOf('/') + 1);
        if (SHA256_NAME.test(name) && !known.has(name) && file.modifiedAt < cutoff) orphans.push(file.key);
      }
      for (const key of orphans) await files.delete(key);
      return orphans.length;
    },
  };
}

// Collection and the orphan sweep each get their own transaction so one failing does not undo the other.
export function createBlobMaintenanceTask(deps: { uow: OwnerUnitOfWork; blobs: BlobService; logger: Logger }): PeriodicTask {
  const { uow, blobs, logger } = deps;
  return {
    id: 'platform.blobMaintenance',
    intervalMs: MAINTENANCE_INTERVAL_MS,
    async run(owner) {
      const collected = await uow.write(owner, (tx) => blobs.collectGarbage(tx));
      const swept = await uow.write(owner, (tx) => blobs.sweepOrphanFiles(tx));
      if (collected.marked + collected.unmarked + collected.deleted + swept > 0) {
        logger.info({ ...collected, orphanFiles: swept }, 'blob maintenance');
      }
    },
  };
}
