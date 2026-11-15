import { describe, expect, it } from 'vitest';
import {
  TAB_ID,
  countDrafts,
  draftKey,
  pendingDraftsFor,
  readDraft,
  readDrafts,
  removeAllDrafts,
  writeDraft,
  type StoredDraft,
} from './draft-store';

const ENTITY = '11111111-1111-1111-1111-111111111111';
const LIVE = { tabId: TAB_ID, since: '2026-11-14T12:00:00.000Z' };

function sample(overrides: Partial<StoredDraft> = {}): StoredDraft {
  return {
    entityId: ENTITY,
    tabId: 'tab-a',
    baseVersion: 1,
    state: {
      title: 'Satu',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      context: { summary: null, whenToUse: null, source: null, aliases: [] },
      properties: {},
    },
    updatedAt: '2026-11-14T10:00:00.000Z',
    ...overrides,
  };
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key) {
      return data.get(key) ?? null;
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

function throwingStorage(): Storage {
  const deny = (): never => {
    throw new Error('denied');
  };
  return {
    get length() {
      return deny();
    },
    clear: deny,
    getItem: deny,
    key: deny,
    removeItem: deny,
    setItem: deny,
  };
}

describe('draft store', () => {
  it('writes and reads drafts newest first', () => {
    const storage = memoryStorage();
    writeDraft(storage, sample({ tabId: 'old', updatedAt: '2026-11-14T09:00:00.000Z', state: { ...sample().state, title: 'Lama' } }));
    writeDraft(storage, sample({ tabId: 'new', updatedAt: '2026-11-14T11:00:00.000Z', state: { ...sample().state, title: 'Baru' } }));
    const drafts = readDrafts(storage, ENTITY);
    expect(drafts.map((draft) => draft.tabId)).toEqual(['new', 'old']);
    expect(drafts[0]?.state.title).toBe('Baru');
  });

  it('ignores and removes a corrupt entry', () => {
    const storage = memoryStorage();
    writeDraft(storage, sample({ tabId: 'ok' }));
    storage.setItem(draftKey(ENTITY, 'bad'), '{not-json');
    const drafts = readDrafts(storage, ENTITY);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.tabId).toBe('ok');
    expect(storage.getItem(draftKey(ENTITY, 'bad'))).toBeNull();
  });

  it('removeAllDrafts clears only archlin drafts', () => {
    const storage = memoryStorage();
    writeDraft(storage, sample());
    writeDraft(storage, sample({ entityId: '22222222-2222-2222-2222-222222222222', tabId: 'other' }));
    storage.setItem('theme', 'dark');
    storage.setItem('archlin.contextCard.collapsed', '1');
    expect(removeAllDrafts(storage)).toBe(2);
    expect(storage.getItem('theme')).toBe('dark');
    expect(storage.getItem('archlin.contextCard.collapsed')).toBe('1');
    expect(countDrafts(storage)).toBe(0);
  });

  it('a storage that throws on write does not break the editor', () => {
    expect(() => writeDraft(throwingStorage(), sample())).not.toThrow();
    expect(countDrafts(throwingStorage())).toBe(0);
  });

  it("pendingDraftsFor hides this tab's draft written since the editor mounted", () => {
    const storage = memoryStorage();
    const server = sample().state;
    writeDraft(storage, sample({ tabId: TAB_ID, updatedAt: '2026-11-14T12:00:05.000Z', state: { ...server, title: 'Lokal' } }));
    writeDraft(storage, sample({ tabId: 'other', updatedAt: '2026-11-14T11:00:00.000Z', state: { ...server, title: 'Lain' } }));
    writeDraft(storage, sample({ tabId: 'same', updatedAt: '2026-11-14T13:00:00.000Z', state: server }));
    const pending = pendingDraftsFor(storage, ENTITY, server, LIVE);
    expect(pending.map((draft) => draft.tabId)).toEqual(['other']);
  });

  it("pendingDraftsFor offers this tab's draft from before a remount", () => {
    const storage = memoryStorage();
    const server = sample().state;
    writeDraft(storage, sample({ tabId: TAB_ID, updatedAt: '2026-11-14T11:59:00.000Z', state: { ...server, title: 'Lokal' } }));
    expect(pendingDraftsFor(storage, ENTITY, server, LIVE).map((draft) => draft.tabId)).toEqual([TAB_ID]);
  });

  it('readDraft returns only the requested tab', () => {
    const storage = memoryStorage();
    writeDraft(storage, sample({ tabId: 'tab-a' }));
    writeDraft(storage, sample({ tabId: 'other' }));
    expect(readDraft(storage, ENTITY, 'other')?.tabId).toBe('other');
    expect(readDraft(storage, ENTITY, 'unknown')).toBeNull();
  });
});
