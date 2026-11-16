import type { OutboundLink } from '@archlin/platform/contracts';
import { describe, expect, it } from 'vitest';
import { createLinkTargetStore } from './link-targets';

const live: OutboundLink = {
  key: 'T1',
  kind: 'wikilink',
  targetTitle: 'Rollback',
  target: { id: 'T1', title: 'Rollback Postgres 16', icon: null, spaceSlug: 'kerja', trashed: false },
  ambiguous: false,
};

describe('createLinkTargetStore', () => {
  it('set notifies subscribers and replace swaps every entry', () => {
    const store = createLinkTargetStore([]);
    const calls: number[] = [];
    const stop = store.subscribe(() => calls.push(1));
    store.set(live);
    expect(store.get('T1')?.target?.title).toBe('Rollback Postgres 16');
    store.replace([]);
    expect(store.get('T1')).toBeUndefined();
    stop();
    store.set(live);
    expect(calls).toHaveLength(2);
  });
});
