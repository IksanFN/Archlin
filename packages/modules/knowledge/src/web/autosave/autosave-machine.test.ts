import { describe, expect, it } from 'vitest';
import { autosaveReducer, invalidReason, retryDelayMs, type AutosaveState, type PageDraftState } from './autosave-machine';

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
  };
}

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
    state = autosaveReducer(state, { type: 'saveStarted' });
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
    state = autosaveReducer(state, { type: 'saveStarted' });
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
    state = autosaveReducer(state, { type: 'saveStarted' });
    state = autosaveReducer(state, { type: 'failed', kind: 'network' });
    expect(state.status).toBe('error');
    expect(state.attempt).toBe(1);
    expect(retryDelayMs(state.attempt)).toBe(1000);
  });

  it('a conflict stops sending until resolved', () => {
    const local = draft('lokal');
    let state = autosaveReducer(idle(), { type: 'edit', state: local });
    state = autosaveReducer(state, { type: 'saveStarted' });
    state = autosaveReducer(state, { type: 'conflict', currentVersion: 4 });
    expect(state.status).toBe('conflict');
    expect(state.conflictVersion).toBe(4);
    expect(state.inFlight).toBeNull();
    expect(autosaveReducer(state, { type: 'saveStarted' }).status).toBe('conflict');
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

  it('trashed stops sending and restored resumes', () => {
    let state = autosaveReducer(idle(), { type: 'edit', state: draft('satu') });
    state = autosaveReducer(state, { type: 'saveStarted' });
    state = autosaveReducer(state, { type: 'trashed' });
    expect(state.status).toBe('trashed');
    expect(state.inFlight).toBeNull();
    expect(autosaveReducer(state, { type: 'saveStarted' }).status).toBe('trashed');
    state = autosaveReducer(state, { type: 'restored' });
    expect(state.status).toBe('dirty');
  });

  it('invalid waits for the next edit', () => {
    const issues = [{ path: 'properties.due', message: 'invalid_property' }] as const;
    let state = autosaveReducer(idle(), { type: 'edit', state: draft('satu') });
    state = autosaveReducer(state, { type: 'saveStarted' });
    state = autosaveReducer(state, { type: 'invalid', issues });
    expect(state.status).toBe('invalid');
    expect(state.issues).toEqual(issues);
    expect(autosaveReducer(state, { type: 'saveStarted' }).status).toBe('invalid');
    const next = draft('dua');
    state = autosaveReducer(state, { type: 'edit', state: next });
    expect(state.status).toBe('dirty');
    expect(state.latest).toEqual(next);
    expect(state.issues).toEqual([]);
  });

  it('retry after a lost response does not open the conflict dialog', () => {
    const sent = draft('satu');
    let state = autosaveReducer(idle(sent), { type: 'edit', state: sent });
    state = autosaveReducer(state, { type: 'saveStarted' });
    state = autosaveReducer(state, { type: 'failed', kind: 'network' });
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

describe('invalidReason', () => {
  it('points at the content when the document was rejected', () => {
    expect(invalidReason([{ path: 'content', message: 'unsafe_url' }])).toBe('content');
    expect(invalidReason([{ path: 'properties.risk', message: 'invalid_property' }])).toBe('properties');
  });
});
