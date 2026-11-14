import type { PageDraftState } from './autosave-machine';

const DRAFT_PREFIX = 'archlin.draft.';

// A new id per JS load so duplicating a tab (which copies sessionStorage) cannot share a draft key.
export const TAB_ID = crypto.randomUUID();

export interface StoredDraft {
  entityId: string;
  tabId: string;
  baseVersion: number;
  state: PageDraftState;
  updatedAt: string;
}

export function draftKey(entityId: string, tabId: string): string {
  return `${DRAFT_PREFIX}${entityId}.${tabId}`;
}

function isDraftKey(key: string): boolean {
  return key.startsWith(DRAFT_PREFIX);
}

function storageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}

function parseDraft(raw: string): StoredDraft | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.entityId !== 'string' || typeof record.tabId !== 'string') return null;
    if (typeof record.baseVersion !== 'number' || typeof record.updatedAt !== 'string') return null;
    if (typeof record.state !== 'object' || record.state === null) return null;
    const state = record.state as Record<string, unknown>;
    if (typeof state.title !== 'string' || typeof state.content !== 'object' || state.content === null) return null;
    if (typeof state.context !== 'object' || state.context === null) return null;
    if (typeof state.properties !== 'object' || state.properties === null) return null;
    return value as StoredDraft;
  } catch {
    return null;
  }
}

export function writeDraft(storage: Storage, draft: StoredDraft): void {
  try {
    storage.setItem(draftKey(draft.entityId, draft.tabId), JSON.stringify(draft));
  } catch {
    // Private mode and quota errors must not interrupt typing.
  }
}

export function readDrafts(storage: Storage, entityId: string): StoredDraft[] {
  try {
    const drafts: StoredDraft[] = [];
    const stale: string[] = [];
    for (const key of storageKeys(storage)) {
      if (!isDraftKey(key)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const draft = parseDraft(raw);
      if (draft === null) {
        stale.push(key);
        continue;
      }
      if (draft.entityId === entityId) drafts.push(draft);
    }
    for (const key of stale) {
      try {
        storage.removeItem(key);
      } catch {
        // Dropping a corrupt row is best-effort.
      }
    }
    drafts.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0));
    return drafts;
  } catch {
    return [];
  }
}

export function removeDraft(storage: Storage, entityId: string, tabId: string): void {
  try {
    storage.removeItem(draftKey(entityId, tabId));
  } catch {
    // Ignoring a failed delete keeps the editor usable.
  }
}

export function countDrafts(storage: Storage): number {
  try {
    let count = 0;
    for (const key of storageKeys(storage)) {
      if (isDraftKey(key)) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

export function removeAllDrafts(storage: Storage): number {
  try {
    const keys = storageKeys(storage).filter(isDraftKey);
    for (const key of keys) storage.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}

export function browserStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
