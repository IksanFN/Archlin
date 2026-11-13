import type { TreeNode } from '@archlin/platform/contracts';
import { useSyncExternalStore } from 'react';

export type BranchKey = `${string}:${string}`;

export function branchKey(spaceId: string, parentId: string | null): BranchKey {
  return `${spaceId}:${parentId ?? 'root'}`;
}

export type BranchState =
  | { status: 'idle' }
  | { status: 'loading'; nodes: TreeNode[] | null }
  | { status: 'error'; nodes: TreeNode[] | null }
  | { status: 'ready'; nodes: TreeNode[] };

export interface TreeStore {
  branch(key: BranchKey): BranchState;
  ensure(key: BranchKey): void;
  invalidate(keys: readonly BranchKey[]): void;
  subscribe(listener: () => void): () => void;
}

const IDLE: BranchState = { status: 'idle' };

function parseKey(key: BranchKey): { spaceId: string; parentId: string | null } {
  const split = key.indexOf(':');
  return { spaceId: key.slice(0, split), parentId: key.slice(split + 1) === 'root' ? null : key.slice(split + 1) };
}

export function createTreeStore(load: (spaceId: string, parentId: string | null) => Promise<TreeNode[]>): TreeStore {
  const states = new Map<BranchKey, BranchState>();
  const generation = new Map<BranchKey, number>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function start(key: BranchKey, previous: TreeNode[] | null): void {
    const nextGen = (generation.get(key) ?? 0) + 1;
    generation.set(key, nextGen);
    states.set(key, { status: 'loading', nodes: previous });
    notify();
    const { spaceId, parentId } = parseKey(key);
    void load(spaceId, parentId).then(
      (nodes) => {
        if (generation.get(key) !== nextGen) return;
        states.set(key, { status: 'ready', nodes });
        notify();
      },
      () => {
        if (generation.get(key) !== nextGen) return;
        states.set(key, { status: 'error', nodes: previous });
        notify();
      },
    );
  }

  return {
    branch(key) {
      return states.get(key) ?? IDLE;
    },
    ensure(key) {
      const current = states.get(key) ?? IDLE;
      if (current.status === 'loading' || current.status === 'ready') return;
      start(key, current.status === 'error' ? current.nodes : null);
    },
    invalidate(keys) {
      for (const key of keys) {
        const current = states.get(key) ?? IDLE;
        start(key, current.status === 'idle' ? null : current.nodes);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useBranch(store: TreeStore, key: BranchKey): BranchState {
  return useSyncExternalStore(
    store.subscribe,
    () => store.branch(key),
    () => store.branch(key),
  );
}
