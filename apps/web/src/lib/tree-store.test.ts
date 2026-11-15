import type { TreeNode } from '@archlin/platform/contracts';
import { describe, expect, it } from 'vitest';
import { branchKey, createTreeStore } from './tree-store';

function node(id: string): TreeNode {
  return { id, kind: 'kb.page', title: id, icon: null, isStarred: false, hasChildren: false };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const spaceId = '11111111-1111-1111-1111-111111111111';
const key = branchKey(spaceId, null);

describe('createTreeStore', () => {
  it('ensure loads a branch once while a load is in flight', async () => {
    const first = deferred<TreeNode[]>();
    let calls = 0;
    const store = createTreeStore(() => {
      calls += 1;
      return first.promise;
    });
    store.ensure(key);
    store.ensure(key);
    expect(calls).toBe(1);
    expect(store.branch(key)).toEqual({ status: 'loading', nodes: null });
    first.resolve([node('a')]);
    await first.promise;
    await Promise.resolve();
    expect(store.branch(key)).toEqual({ status: 'ready', nodes: [node('a')] });
  });

  it('invalidate keeps the old nodes visible while it reloads', async () => {
    const first = deferred<TreeNode[]>();
    const second = deferred<TreeNode[]>();
    let calls = 0;
    const store = createTreeStore(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });
    store.ensure(key);
    first.resolve([node('a')]);
    await first.promise;
    await Promise.resolve();
    store.invalidate([key]);
    expect(store.branch(key)).toEqual({ status: 'loading', nodes: [node('a')] });
    expect(calls).toBe(2);
  });

  it('a response that arrives after invalidate is ignored', async () => {
    const first = deferred<TreeNode[]>();
    const second = deferred<TreeNode[]>();
    let calls = 0;
    const store = createTreeStore(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });
    store.ensure(key);
    store.invalidate([key]);
    first.resolve([node('stale')]);
    await first.promise;
    await Promise.resolve();
    expect(store.branch(key)).toEqual({ status: 'loading', nodes: null });
    second.resolve([node('fresh')]);
    await second.promise;
    await Promise.resolve();
    expect(store.branch(key)).toEqual({ status: 'ready', nodes: [node('fresh')] });
  });

  it('drop removes a node from a ready branch immediately', async () => {
    const first = deferred<TreeNode[]>();
    const store = createTreeStore(() => first.promise);
    store.ensure(key);
    first.resolve([node('a'), node('b')]);
    await first.promise;
    await Promise.resolve();
    store.drop(key, 'a');
    expect(store.branch(key)).toEqual({ status: 'ready', nodes: [node('b')] });
    expect(store.loadedKeys()).toEqual([key]);
  });

  it('drop on an idle branch is a no-op', () => {
    const store = createTreeStore(() => Promise.resolve([]));
    store.drop(key, 'a');
    expect(store.branch(key)).toEqual({ status: 'idle' });
    expect(store.loadedKeys()).toEqual([]);
  });

  it('a failed load keeps the previous nodes with status error', async () => {
    const first = deferred<TreeNode[]>();
    const second = deferred<TreeNode[]>();
    let calls = 0;
    const store = createTreeStore(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });
    store.ensure(key);
    first.resolve([node('a')]);
    await first.promise;
    await Promise.resolve();
    store.invalidate([key]);
    second.reject(new Error('offline'));
    await second.promise.catch(() => undefined);
    await Promise.resolve();
    expect(store.branch(key)).toEqual({ status: 'error', nodes: [node('a')] });
  });
});
