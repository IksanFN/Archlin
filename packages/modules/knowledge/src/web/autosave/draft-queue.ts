import type { PageView } from '@archlin/modules-knowledge/shared';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { draftFromPage } from './autosave-machine';
import { browserStorage, pendingDraftsFor, TAB_ID, type StoredDraft } from './draft-store';

const NO_DRAFTS: readonly StoredDraft[] = [];

// Snapshot holder for useSyncExternalStore: localStorage is read again only when the key or the epoch changes.
class DraftQueueStore {
  private epoch = 0;
  private cached: { key: string; drafts: readonly StoredDraft[] } | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    const onStorage = (): void => this.refresh();
    window.addEventListener('storage', onStorage);
    return () => {
      this.listeners.delete(onChange);
      window.removeEventListener('storage', onStorage);
    };
  };

  refresh = (): void => {
    this.epoch += 1;
    for (const listener of this.listeners) listener();
  };

  read(serverKey: string, load: () => readonly StoredDraft[]): readonly StoredDraft[] {
    const key = `${serverKey}:${this.epoch}`;
    if (this.cached?.key !== key) this.cached = { key, drafts: load() };
    return this.cached.drafts;
  }
}

// Drafts other sessions of this page left behind. A draft the live editor itself wrote is not one of them.
export function useDraftQueue(
  page: PageView,
  liveSince: string,
): { drafts: readonly StoredDraft[]; refresh: () => void } {
  const [store] = useState(() => new DraftQueueStore());
  const getSnapshot = useCallback(
    () =>
      store.read(`${page.entityId}:${page.version}`, () => {
        const storage = browserStorage();
        if (storage === null) return NO_DRAFTS;
        return pendingDraftsFor(storage, page.entityId, draftFromPage(page), { tabId: TAB_ID, since: liveSince });
      }),
    [store, page, liveSince],
  );
  const drafts = useSyncExternalStore(store.subscribe, getSnapshot, () => NO_DRAFTS);
  return { drafts, refresh: store.refresh };
}
