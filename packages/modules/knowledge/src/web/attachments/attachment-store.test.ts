import type { AttachmentView } from '@archlin/modules-knowledge/shared';
import { describe, expect, it } from 'vitest';
import { createAttachmentStore } from './attachment-store';

const viewOf = (id: string, pageId: string): AttachmentView => ({
  id,
  pageId,
  filename: 'a.pdf',
  mime: 'application/pdf',
  size: 10,
  kind: 'pdf',
  extraction: 'pending',
  referenced: true,
  trashed: false,
  createdAt: '2026-11-16T00:00:00Z',
});

describe('createAttachmentStore', () => {
  it('upsert replaces an attachment by id and notifies every change', () => {
    const store = createAttachmentStore([]);
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    const first = viewOf('A1', 'P1');
    store.upsert(first);
    store.upsert({ ...first, filename: 'b.pdf' });
    expect(store.all()).toEqual([{ ...first, filename: 'b.pdf' }]);
    expect(calls).toBe(2);
  });

  it('replace swaps the whole list and get reads by id', () => {
    const store = createAttachmentStore([viewOf('A1', 'P1')]);
    store.replace([viewOf('A2', 'P1')]);
    expect(store.get('A1')).toBeUndefined();
    expect(store.get('A2')?.id).toBe('A2');
  });

  it('unsubscribing stops notifications', () => {
    const store = createAttachmentStore([]);
    let calls = 0;
    const stop = store.subscribe(() => {
      calls += 1;
    });
    stop();
    store.upsert(viewOf('A1', 'P1'));
    expect(calls).toBe(0);
  });
});
