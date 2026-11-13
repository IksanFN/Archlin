import { useRef, useSyncExternalStore } from 'react';
import { exitMs, MOTION_MS, prefersReducedMotion } from './motion';

type LeavingStore<K> = {
  keys: Set<K>;
  version: number;
  listeners: Set<() => void>;
};

function notify<K>(store: LeavingStore<K>): void {
  store.version += 1;
  for (const listener of store.listeners) listener();
}

export function useLeaving<K>(): {
  isLeaving(key: K): boolean;
  leave(key: K): Promise<void>;
} {
  const storeRef = useRef<LeavingStore<K> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = { keys: new Set<K>(), version: 0, listeners: new Set() };
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
      return store.keys.has(key);
    },
    leave(key: K): Promise<void> {
      const delay = prefersReducedMotion() ? 0 : exitMs(MOTION_MS.base);
      if (delay === 0) return Promise.resolve();
      store.keys.add(key);
      notify(store);
      // Keys stay in the set: unmount is the caller's job; notifying a smaller set would snap the exit.
      return new Promise((resolve) => {
        setTimeout(resolve, delay);
      });
    },
  };
}
