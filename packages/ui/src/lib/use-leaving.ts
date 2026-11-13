import { useRef, useSyncExternalStore } from 'react';
import { exitMs, MOTION_MS, prefersReducedMotion } from './motion';

type LeavingStore<K> = {
  keys: Set<K>;
  published: Set<K>;
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
      store.keys.add(key);
      store.published.add(key);
      notify(store);
      const finish = (resolve: () => void): void => {
        store.keys.delete(key);
        resolve();
        queueMicrotask(() => {
          // Release after the caller unmounts; do not notify or a still-painted row would snap back.
          if (!store.keys.has(key)) store.published.delete(key);
        });
      };
      if (delay === 0) return new Promise(finish);
      return new Promise((resolve) => {
        setTimeout(() => finish(resolve), delay);
      });
    },
  };
}
