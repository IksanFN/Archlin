import { useRef, useSyncExternalStore } from 'react';
import { exitMs, MOTION_MS, prefersReducedMotion } from './motion';

type LeavingStore<K> = {
  keys: Set<K>;
  published: Set<K>;
  version: number;
  listeners: Set<() => void>;
};

function notify<K>(store: LeavingStore<K>): void {
  store.published = new Set(store.keys);
  store.version += 1;
  for (const listener of store.listeners) listener();
}

export function useLeaving<K>(): {
  isLeaving(key: K): boolean;
  leave(key: K): Promise<void>;
} {
  const storeRef = useRef<LeavingStore<K> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = { keys: new Set<K>(), published: new Set<K>(), version: 0, listeners: new Set() };
  }
  const store = storeRef.current;

  useSyncExternalStore(
    (onStoreChange) => {
      store.listeners.add(onStoreChange);
      return () => {
        store.listeners.delete(onStoreChange);
      };
    },
    () => store.version,
    () => store.version,
  );

  return {
    isLeaving(key: K): boolean {
      return store.published.has(key);
    },
    leave(key: K): Promise<void> {
      const delay = prefersReducedMotion() ? 0 : exitMs(MOTION_MS.base);
      if (delay === 0) return Promise.resolve();
      store.keys.add(key);
      notify(store);
      return new Promise((resolve) => {
        setTimeout(() => {
          // Drop the live key for later reuse, but do not notify: a re-render here would
          // clear data-leaving before the caller unmounts the row.
          store.keys.delete(key);
          resolve();
        }, delay);
      });
    },
  };
}
