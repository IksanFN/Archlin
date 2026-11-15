import type { SnapshotReason } from '../shared/inputs';

export const IDLE_SNAPSHOT_MS = 600_000;

export interface SnapshotDecision {
  reason: SnapshotReason;
  now: Date;
  lastSavedAt: Date;
  currentHash: string;
  lastSnapshotHash: string | null;
}

// An identical state is never stored twice; an idle snapshot also waits for a real pause in editing.
export function shouldSnapshot(input: SnapshotDecision): boolean {
  if (input.currentHash === input.lastSnapshotHash) return false;
  if (input.reason === 'idle') return input.now.getTime() - input.lastSavedAt.getTime() > IDLE_SNAPSHOT_MS;
  return true;
}
