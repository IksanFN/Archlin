import type { AutosaveStatus } from './autosave-machine';

// Only a settled page is worth a leave snapshot: while edits are unsaved the server copy is older than what the user sees.
export function leaveSnapshotAllowed(status: AutosaveStatus, trashed: boolean): boolean {
  return !trashed && (status === 'idle' || status === 'saved');
}
