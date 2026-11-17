import { sqlFor } from '@archlin/db/scoped';
import type { Clock, Logger, OwnerScope, OwnerUnitOfWork } from '@archlin/kernel';
import { blobKey } from '@archlin/platform/contracts';
import type { ExtractResult } from '@archlin/platform/contracts';
import { FileMissingError } from '@archlin/platform/server';
import type { FileStorage, PeriodicTask, TreeService } from '@archlin/platform/server';
import { sql } from 'kysely';
import type { KnowledgeDatabase } from '../schema';
import { EXTRACTION_LIMITS, normalizeExtracted } from './extractors';
import type { ExtractionRunner } from './runner';

const ROUND_SIZE = 5;
const TASK_INTERVAL_MS = 5_000;

interface Claim {
  entity_id: string;
  blob_sha256: string;
  mime: string;
  extraction_attempts: number;
}

// Failures that retrying cannot fix are final at once; a timeout or crash may be bad luck, so it gets three tries.
function isFinal(result: ExtractResult, attempts: number): boolean {
  if (result.status !== 'failed') return true;
  if (result.error === 'timeout' || result.error === 'crashed') return attempts >= EXTRACTION_LIMITS.maxAttempts;
  return true;
}

export function createAttachmentExtractionTask(deps: {
  uow: OwnerUnitOfWork;
  clock: Clock;
  files: FileStorage;
  tree: TreeService;
  runner: ExtractionRunner;
  logger: Logger;
}): PeriodicTask {
  const { uow, clock, files, tree, runner, logger } = deps;

  // Claiming commits before any work starts: nothing holds a transaction or a row lock while a file is read or parsed.
  async function claimNext(owner: OwnerScope, handled: readonly string[], leaseUntil: Date): Promise<(Claim & { lease: Date }) | null> {
    return uow.write(owner, async (tx) => {
      // MATERIALIZED matters: inlined, the planner may rerun the LIMIT 1 subquery per row and one update would claim every row.
      const { rows } = await sql<Claim>`
        with picked as materialized (
          select c.entity_id from kb_attachments c
          inner join entities e on e.owner_id = c.owner_id and e.id = c.entity_id
          where c.extraction_status = 'pending'
            and (c.extraction_lease_until is null or c.extraction_lease_until < ${clock.now()})
            and e.deleted_at is null
            and c.entity_id <> all(${[...handled]}::uuid[])
          order by c.created_at, c.entity_id
          limit 1
          for update of c skip locked
        )
        update kb_attachments a
        set extraction_lease_until = ${leaseUntil}, extraction_attempts = a.extraction_attempts + 1
        from picked
        where a.entity_id = picked.entity_id
        returning a.entity_id, a.blob_sha256, a.mime, a.extraction_attempts`.execute(sqlFor<KnowledgeDatabase>(tx));
      const claim = rows[0];
      return claim ? { ...claim, lease: leaseUntil } : null;
    });
  }

  async function extract(owner: OwnerScope, claim: Claim, signal: AbortSignal): Promise<ExtractResult> {
    try {
      const bytes = await files.read(blobKey(owner.ownerId, claim.blob_sha256));
      return await runner.run({ mime: claim.mime, bytes }, signal);
    } catch (err) {
      if (err instanceof FileMissingError) return { status: 'failed', error: 'blob_missing' };
      // An abort passes through untouched: the worker is stopping and the lease simply runs out.
      if (err instanceof Error && err.name === 'AbortError') throw err;
      logger.error({ attachmentId: claim.entity_id, errorName: err instanceof Error ? err.name : 'unknown' }, 'extraction run failed');
      return { status: 'failed', error: 'crashed' };
    }
  }

  // Compare-and-set on the lease: if another round took the attachment over while this one worked, this result is dropped.
  async function store(owner: OwnerScope, claim: Claim & { lease: Date }, result: ExtractResult): Promise<void> {
    const final = isFinal(result, claim.extraction_attempts);
    const text = result.status === 'done' ? normalizeExtracted(result.text, EXTRACTION_LIMITS.maxChars) : null;
    const settled: ExtractResult = result.status === 'done' && text === '' ? { status: 'no_text' } : result;
    const status = !final ? 'pending' : settled.status === 'failed' ? 'failed' : settled.status;
    const error = final && settled.status === 'failed' ? settled.error : null;

    const stored = await uow.write(owner, async (tx) => {
      const trx = sqlFor<KnowledgeDatabase>(tx);
      const { rows } = await sql<{ alive: boolean }>`
        update kb_attachments a
        set extraction_status = ${status}, extraction_error = ${error},
            extracted_text = ${settled.status === 'done' ? text : null}, extraction_lease_until = null
        where a.entity_id = ${claim.entity_id} and a.extraction_status = 'pending' and a.extraction_lease_until = ${claim.lease}
        returning (select e.deleted_at is null from entities e where e.owner_id = a.owner_id and e.id = a.entity_id) as alive`.execute(trx);
      const row = rows[0];
      // The text index (M3) listens for this. A trashed attachment keeps its result but is not announced.
      if (row?.alive && settled.status === 'done') await tree.touch(tx, claim.entity_id, ['extractedText']);
      return row !== undefined;
    });
    logger.info(
      { attachmentId: claim.entity_id, status: stored ? status : 'discarded', ...(error === null ? {} : { error }) },
      'attachment extraction',
    );
  }

  return {
    id: 'kb.attachmentExtraction',
    intervalMs: TASK_INTERVAL_MS,

    async run(owner, signal) {
      // An attachment is handled once per round, so a retry waits for the next round instead of looping here.
      const handled: string[] = [];
      while (handled.length < ROUND_SIZE && !signal.aborted) {
        const leaseUntil = new Date(clock.now().getTime() + EXTRACTION_LIMITS.leaseMs);
        const claim = await claimNext(owner, handled, leaseUntil);
        if (claim === null) return;
        handled.push(claim.entity_id);
        await store(owner, claim, await extract(owner, claim, signal));
      }
    },
  };
}
