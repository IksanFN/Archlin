import { PAGE_SAVE_CLIENT_MAX_BYTES } from '@archlin/modules-knowledge/shared';
import { describe, expect, it } from 'vitest';
import {
  autosaveReducer,
  classifySaveError,
  exceedsSaveLimit,
  invalidReason,
  nextSave,
  retryDelayMs,
  type AutosaveState,
  type PageDraftState,
} from './autosave-machine';

function draft(title: string): PageDraftState {
  return {
    title,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    context: { summary: null, whenToUse: null, source: null, aliases: [] },
    properties: {},
  };
}

function idle(latest = draft('satu'), baseVersion = 1): AutosaveState {
  return {
    status: 'idle',
    baseVersion,
    latest,
    inFlight: null,
    attempt: 0,
    savedAt: null,
    conflictVersion: null,
    issues: [],
    unconfirmed: null,
  };
}

// Mirrors the hook: a save starts with whatever nextSave names, or with latest when nothing is due.
function start(state: AutosaveState): AutosaveState {
  const next = nextSave(state);
  return autosaveReducer(state, { type: 'saveStarted', draft: next?.draft ?? state.latest });
}

const savedAt = '2026-11-14T10:00:00.000Z';

describe('autosaveReducer', () => {
  it('an edit marks the page dirty', () => {
    const next = draft('halo');
    const state = autosaveReducer(idle(), { type: 'edit', state: next });
    expect(state.status).toBe('dirty');
    expect(state.latest).toEqual(next);
  });

  it('saved with the same state ends in saved', () => {
    const sent = draft('satu');
    let state = autosaveReducer(idle(sent), { type: 'edit', state: sent });
    state = start(state);
    state = autosaveReducer(state, {
      type: 'saved',
      result: { status: 'saved', version: 2, savedAt: '2026-11-14T10:00:00.000Z' },
      sent,
    });
    expect(state.status).toBe('saved');
    expect(state.baseVersion).toBe(2);
    expect(state.savedAt).toBe('2026-11-14T10:00:00.000Z');
    expect(state.inFlight).toBeNull();
    expect(state.attempt).toBe(0);
  });

  it('an edit during a save keeps the page dirty with the new base version', () => {
    const sent = draft('satu');
    const edited = draft('dua');
    let state = autosaveReducer(idle(sent), { type: 'edit', state: sent });
    state = start(state);
    state = autosaveReducer(state, { type: 'edit', state: edited });
    state = autosaveReducer(state, {
      type: 'saved',
      result: { status: 'saved', version: 3, savedAt: '2026-11-14T10:01:00.000Z' },
      sent,
    });
    expect(state.status).toBe('dirty');
    expect(state.baseVersion).toBe(3);
    expect(state.latest).toEqual(edited);
  });

  it('a network failure retries with growing delays', () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelayMs)).toEqual([1000, 2000, 5000, 10000, 30000, 30000]);
    let state = autosaveReducer(idle(), { type: 'edit', state: draft('satu') });
    state = start(state);
    state = autosaveReducer(state, { type: 'failed', kind: 'network' });
    expect(state.status).toBe('error');
    expect(state.attempt).toBe(1);
    expect(retryDelayMs(state.attempt)).toBe(1000);
  });

  it('a conflict stops sending until resolved', () => {
    const local = draft('lokal');
    let state = autosaveReducer(idle(), { type: 'edit', state: local });
    state = start(state);
    state = autosaveReducer(state, { type: 'conflict', currentVersion: 4 });
    expect(state.status).toBe('conflict');
    expect(state.conflictVersion).toBe(4);
    expect(state.inFlight).toBeNull();
    expect(start(state).status).toBe('conflict');
    expect(autosaveReducer(state, { type: 'flush' }).status).toBe('conflict');
    const edited = draft('masih lokal');
    state = autosaveReducer(state, { type: 'edit', state: edited });
    expect(state.status).toBe('conflict');
    expect(state.latest).toEqual(edited);
    state = autosaveReducer(state, { type: 'rebased', version: 4, state: draft('server') });
    expect(state.status).toBe('saved');
    expect(state.baseVersion).toBe(4);
    expect(state.conflictVersion).toBeNull();
  });

  it('trashed stops sending', () => {
    let state = autosaveReducer(idle(), { type: 'edit', state: draft('satu') });
    state = start(state);
    state = autosaveReducer(state, { type: 'trashed' });
    expect(state.status).toBe('trashed');
    expect(state.inFlight).toBeNull();
    expect(start(state).status).toBe('trashed');
  });

  it('invalid waits for the next edit', () => {
    const issues = [{ path: 'properties.due', message: 'invalid_property' }] as const;
    let state = autosaveReducer(idle(), { type: 'edit', state: draft('satu') });
    state = start(state);
    state = autosaveReducer(state, { type: 'invalid', issues });
    expect(state.status).toBe('invalid');
    expect(state.issues).toEqual(issues);
    expect(start(state).status).toBe('invalid');
    const next = draft('dua');
    state = autosaveReducer(state, { type: 'edit', state: next });
    expect(state.status).toBe('dirty');
    expect(state.latest).toEqual(next);
    expect(state.issues).toEqual([]);
  });

  it('retry after a lost response does not open the conflict dialog', () => {
    const sent = draft('satu');
    let state = autosaveReducer(idle(sent), { type: 'edit', state: sent });
    state = start(state);
    state = autosaveReducer(state, { type: 'failed', kind: 'network' });
    state = start(state);
    state = autosaveReducer(state, {
      type: 'saved',
      result: { status: 'unchanged', version: 2, savedAt: '2026-11-14T10:02:00.000Z' },
      sent,
    });
    expect(state.status).toBe('saved');
    expect(state.status).not.toBe('conflict');
    expect(state.conflictVersion).toBeNull();
    expect(state.baseVersion).toBe(2);
  });
});

describe('server state and recovery', () => {
  const trashedWith = (latest: PageDraftState): AutosaveState => ({ ...idle(latest, 3), status: 'trashed' });

  it('a newer server version is adopted while nothing is unsaved', () => {
    const next = autosaveReducer(idle(draft('lama'), 3), {
      type: 'serverState',
      version: 4,
      state: draft('baru'),
      trashed: false,
    });
    expect(next).toMatchObject({ status: 'idle', baseVersion: 4, latest: draft('baru') });
  });

  it('a newer server version is ignored while edits are unsaved', () => {
    const dirty = autosaveReducer(idle(draft('a'), 3), { type: 'edit', state: draft('b') });
    const next = autosaveReducer(dirty, { type: 'serverState', version: 4, state: draft('c'), trashed: false });
    expect(next).toEqual(dirty);
  });

  it('a page restored elsewhere resumes saving the unsaved edits', () => {
    const next = autosaveReducer(trashedWith(draft('lokal')), {
      type: 'serverState',
      version: 3,
      state: draft('server'),
      trashed: false,
    });
    expect(next).toMatchObject({ status: 'dirty', latest: draft('lokal'), attempt: 0 });
  });

  it('a page restored elsewhere without local edits returns to idle', () => {
    const next = autosaveReducer(trashedWith(draft('sama')), {
      type: 'serverState',
      version: 3,
      state: draft('sama'),
      trashed: false,
    });
    expect(next.status).toBe('idle');
  });

  it('a server state that is still trashed changes nothing', () => {
    const state = trashedWith(draft('lokal'));
    const next = autosaveReducer(state, { type: 'serverState', version: 3, state: draft('server'), trashed: true });
    expect(next).toEqual(state);
  });

  it('a lost response is confirmed before newer edits are sent', () => {
    const s1 = draft('satu');
    const s2 = draft('dua');
    let state = autosaveReducer(idle(draft('awal'), 3), { type: 'edit', state: s1 });
    state = start(state);
    state = autosaveReducer(state, { type: 'edit', state: s2 });
    state = autosaveReducer(state, { type: 'failed', kind: 'network' });
    expect(nextSave(state)).toEqual({ draft: s1, baseVersion: 3 });
    state = start(state);
    state = autosaveReducer(state, { type: 'saved', result: { status: 'unchanged', version: 4, savedAt }, sent: s1 });
    expect(state).toMatchObject({ status: 'dirty', unconfirmed: null, baseVersion: 4 });
    expect(nextSave(state)).toEqual({ draft: s2, baseVersion: 4 });
  });

  it('an unconfirmed draft that never reached the server is saved before newer edits', () => {
    const s1 = draft('satu');
    const s2 = draft('dua');
    let state = autosaveReducer(idle(draft('awal'), 3), { type: 'edit', state: s1 });
    state = start(state);
    state = autosaveReducer(state, { type: 'edit', state: s2 });
    state = autosaveReducer(state, { type: 'failed', kind: 'offline' });
    state = start(state);
    state = autosaveReducer(state, { type: 'saved', result: { status: 'saved', version: 4, savedAt }, sent: s1 });
    expect(state.status).toBe('dirty');
    expect(nextSave(state)).toEqual({ draft: s2, baseVersion: 4 });
    state = start(state);
    state = autosaveReducer(state, { type: 'saved', result: { status: 'saved', version: 5, savedAt }, sent: s2 });
    expect(state).toMatchObject({ status: 'saved', baseVersion: 5, unconfirmed: null });
  });

  it('a server error keeps the unconfirmed draft it already had', () => {
    const s1 = draft('satu');
    let state = autosaveReducer(idle(draft('awal'), 3), { type: 'edit', state: s1 });
    state = autosaveReducer(start(state), { type: 'failed', kind: 'network' });
    state = autosaveReducer(start(state), { type: 'failed', kind: 'server' });
    expect(state.unconfirmed).toEqual(s1);
  });

  it('a draft the server rejects is no longer unconfirmed', () => {
    let state = autosaveReducer(idle(draft('awal'), 3), { type: 'edit', state: draft('satu') });
    state = autosaveReducer(start(state), { type: 'failed', kind: 'network' });
    state = autosaveReducer(start(state), {
      type: 'invalid',
      issues: [{ path: 'content', message: 'unsafe_url' }],
    });
    expect(state.unconfirmed).toBeNull();
    state = autosaveReducer(state, { type: 'edit', state: draft('dua') });
    expect(nextSave(state)).toEqual({ draft: draft('dua'), baseVersion: 3 });
  });

  it('a conflict drops the unconfirmed draft because the server content differs', () => {
    let state = autosaveReducer(idle(draft('awal'), 3), { type: 'edit', state: draft('satu') });
    state = autosaveReducer(start(state), { type: 'failed', kind: 'network' });
    state = autosaveReducer(start(state), { type: 'conflict', currentVersion: 5 });
    expect(state.unconfirmed).toBeNull();
  });

  it('nextSave is null unless a save is due', () => {
    expect(nextSave(idle())).toBeNull();
    expect(nextSave({ ...idle(), status: 'saving' })).toBeNull();
    expect(nextSave({ ...idle(), status: 'conflict' })).toBeNull();
  });

  it('signedOut keeps edits and stops sending', () => {
    let state = autosaveReducer(idle(), { type: 'edit', state: draft('satu') });
    state = autosaveReducer(start(state), { type: 'signedOut' });
    expect(state.status).toBe('signedOut');
    state = autosaveReducer(state, { type: 'edit', state: draft('dua') });
    expect(state).toMatchObject({ status: 'signedOut', latest: draft('dua') });
    expect(nextSave(state)).toBeNull();
  });

  it('an edit after tooLarge tries again', () => {
    let state = autosaveReducer(idle(), { type: 'edit', state: draft('satu') });
    state = autosaveReducer(start(state), { type: 'tooLarge' });
    expect(state.status).toBe('tooLarge');
    expect(nextSave(state)).toBeNull();
    state = autosaveReducer(state, { type: 'edit', state: draft('dua') });
    expect(state.status).toBe('dirty');
  });
});

describe('classifySaveError', () => {
  const issues = [{ path: 'content', message: 'unsafe_url' }];

  it.each([
    [{ status: 401, code: 'unauthenticated', details: null }, { type: 'signedOut' }],
    [{ status: 413, code: 'payload_too_large', details: null }, { type: 'tooLarge' }],
    [{ status: 409, code: 'entity_in_trash', details: null }, { type: 'trashed' }],
    [{ status: 409, code: 'page_in_trash', details: null }, { type: 'trashed' }],
    [{ status: 409, code: 'page_conflict', details: { currentVersion: 7 } }, { type: 'conflict', currentVersion: 7 }],
    [{ status: 422, code: 'unsafe_url', details: { issues } }, { type: 'invalid', issues }],
    [{ status: 500, code: 'internal', details: null }, { type: 'failed', kind: 'server' }],
    [{ status: 409, code: 'page_conflict', details: null }, { type: 'failed', kind: 'server' }],
    [null, { type: 'failed', kind: 'network' }],
  ])('maps %o', (error, event) => {
    expect(classifySaveError(error, true)).toEqual(event);
  });

  it('a transport failure while offline is reported as offline', () => {
    expect(classifySaveError(null, false)).toEqual({ type: 'failed', kind: 'offline' });
  });
});

describe('exceedsSaveLimit', () => {
  const input = (text: string) => ({
    entityId: '00000000-0000-4000-8000-000000000000',
    baseVersion: 1,
    title: 'x',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    context: { summary: null, whenToUse: null, source: null, aliases: [] },
    properties: {},
  });

  it('is true just past the client cap', () => {
    expect(exceedsSaveLimit(input('a'.repeat(PAGE_SAVE_CLIENT_MAX_BYTES)))).toBe(true);
    expect(exceedsSaveLimit(input('pendek'))).toBe(false);
  });
});

describe('invalidReason', () => {
  it('points at the content when the document was rejected', () => {
    expect(invalidReason([{ path: 'content', message: 'unsafe_url' }])).toBe('content');
    expect(invalidReason([{ path: 'properties.risk', message: 'invalid_property' }])).toBe('properties');
  });
});
