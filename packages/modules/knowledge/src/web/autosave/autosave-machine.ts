import { PAGE_SAVE_CLIENT_MAX_BYTES, canonicalJson } from '@archlin/modules-knowledge/shared';
import type { ContextFields, PageView, SavePageInput, SaveResult } from '@archlin/modules-knowledge/shared';
import type { SaveStatusState } from '@archlin/ui/components/save-status';
import type { JSONContent } from '@tiptap/core';

export const AUTOSAVE_DEBOUNCE_MS = 1000;

const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000] as const;
const RETRY_DELAY_CAP_MS = 30_000;

export interface PageDraftState {
  title: string;
  content: JSONContent;
  context: ContextFields;
  properties: Record<string, unknown>;
}

export type AutosaveStatus =
  | 'idle'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'error'
  | 'offline'
  | 'conflict'
  | 'trashed'
  | 'invalid'
  | 'signedOut'
  | 'tooLarge';

export interface AutosaveState {
  status: AutosaveStatus;
  baseVersion: number;
  latest: PageDraftState;
  inFlight: PageDraftState | null;
  attempt: number;
  savedAt: string | null;
  conflictVersion: number | null;
  issues: readonly { path: string; message: string }[];
  // A draft whose response was lost: it may have committed, so it is confirmed before newer edits are sent.
  unconfirmed: PageDraftState | null;
}

export type AutosaveEvent =
  | { type: 'edit'; state: PageDraftState }
  | { type: 'flush' }
  | { type: 'saveStarted'; draft: PageDraftState }
  | { type: 'saved'; result: SaveResult; sent: PageDraftState }
  | { type: 'failed'; kind: 'network' | 'offline' | 'server' }
  | { type: 'conflict'; currentVersion: number }
  | { type: 'trashed' }
  | { type: 'invalid'; issues: readonly { path: string; message: string }[] }
  | { type: 'signedOut' }
  | { type: 'tooLarge' }
  | { type: 'rebased'; version: number; state: PageDraftState }
  | { type: 'serverState'; version: number; state: PageDraftState; trashed: boolean };

const STOPPED: ReadonlySet<AutosaveStatus> = new Set(['conflict', 'trashed', 'invalid', 'signedOut', 'tooLarge']);
// These only collect edits; invalid and tooLarge instead try again on the next edit.
const HOLDING: ReadonlySet<AutosaveStatus> = new Set(['conflict', 'trashed', 'saving', 'signedOut']);

export interface SaveErrorShape {
  status: number;
  code: string;
  details: unknown;
}

function currentVersionOf(details: unknown): number | null {
  if (typeof details !== 'object' || details === null || !('currentVersion' in details)) return null;
  return typeof details.currentVersion === 'number' ? details.currentVersion : null;
}

function issuesOf(details: unknown): readonly { path: string; message: string }[] {
  if (typeof details !== 'object' || details === null || !('issues' in details) || !Array.isArray(details.issues)) {
    return [];
  }
  return details.issues.filter(
    (issue): issue is { path: string; message: string } =>
      typeof issue === 'object' &&
      issue !== null &&
      typeof (issue as { path: unknown }).path === 'string' &&
      typeof (issue as { message: unknown }).message === 'string',
  );
}

// A null error is a transport failure that never produced a server answer.
export function classifySaveError(error: SaveErrorShape | null, online: boolean): AutosaveEvent {
  if (error === null) return { type: 'failed', kind: online ? 'network' : 'offline' };
  if (error.status === 401) return { type: 'signedOut' };
  if (error.status === 413) return { type: 'tooLarge' };
  if (error.status === 409 && (error.code === 'page_in_trash' || error.code === 'entity_in_trash')) {
    return { type: 'trashed' };
  }
  if (error.status === 409 && error.code === 'page_conflict') {
    const currentVersion = currentVersionOf(error.details);
    if (currentVersion !== null) return { type: 'conflict', currentVersion };
  }
  if (error.status === 422) return { type: 'invalid', issues: issuesOf(error.details) };
  return { type: 'failed', kind: 'server' };
}

export function exceedsSaveLimit(input: SavePageInput): boolean {
  return new TextEncoder().encode(JSON.stringify(input)).byteLength > PAGE_SAVE_CLIENT_MAX_BYTES;
}

export function nextSave(state: AutosaveState): { draft: PageDraftState; baseVersion: number } | null {
  if (state.status !== 'dirty' && state.status !== 'error' && state.status !== 'offline') return null;
  return { draft: state.unconfirmed ?? state.latest, baseVersion: state.baseVersion };
}

export function invalidReason(issues: readonly { path: string; message: string }[]): 'content' | 'properties' {
  return issues.some((issue) => issue.path === 'content') ? 'content' : 'properties';
}

export function retryDelayMs(attempt: number): number {
  if (attempt <= 0) return RETRY_DELAYS_MS[0];
  return RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAY_CAP_MS;
}

export function draftFromPage(page: PageView): PageDraftState {
  return {
    title: page.title,
    content: page.content,
    context: page.context,
    properties: page.properties,
  };
}

export function autosaveStateFromPage(page: PageView): AutosaveState {
  return {
    status: page.deletedAt === null ? 'idle' : 'trashed',
    baseVersion: page.version,
    latest: draftFromPage(page),
    inFlight: null,
    attempt: 0,
    savedAt: page.lastSavedAt,
    conflictVersion: null,
    issues: [],
    unconfirmed: null,
  };
}

export function saveStatusOf(status: AutosaveStatus): SaveStatusState {
  // Trash has its own banner; dirty has nothing to announce until a save starts.
  if (status === 'trashed' || status === 'dirty' || status === 'idle') return 'idle';
  return status;
}

function sameDraft(left: PageDraftState, right: PageDraftState): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function autosaveReducer(state: AutosaveState, event: AutosaveEvent): AutosaveState {
  switch (event.type) {
    case 'edit':
      if (HOLDING.has(state.status)) return { ...state, latest: event.state };
      return { ...state, status: 'dirty', latest: event.state, issues: [], attempt: 0 };
    case 'flush':
      return state;
    case 'saveStarted':
      if (STOPPED.has(state.status) || state.status === 'saving' || state.status === 'idle' || state.status === 'saved') {
        return state;
      }
      return { ...state, status: 'saving', inFlight: event.draft };
    case 'saved': {
      const unconfirmed =
        state.unconfirmed !== null && sameDraft(event.sent, state.unconfirmed) ? null : state.unconfirmed;
      const next: AutosaveState = {
        ...state,
        baseVersion: event.result.version,
        savedAt: event.result.savedAt,
        inFlight: null,
        attempt: 0,
        conflictVersion: null,
        issues: [],
        unconfirmed,
      };
      if (unconfirmed === null && sameDraft(event.sent, state.latest)) return { ...next, status: 'saved' };
      return { ...next, status: 'dirty' };
    }
    case 'failed':
      if (STOPPED.has(state.status)) return state;
      return {
        ...state,
        status: event.kind === 'offline' ? 'offline' : 'error',
        attempt: state.attempt + 1,
        inFlight: null,
        unconfirmed: event.kind === 'server' ? state.unconfirmed : (state.inFlight ?? state.unconfirmed),
      };
    case 'conflict':
      return { ...state, status: 'conflict', conflictVersion: event.currentVersion, inFlight: null, unconfirmed: null };
    case 'trashed':
      return { ...state, status: 'trashed', inFlight: null };
    case 'invalid':
      return { ...state, status: 'invalid', issues: event.issues, inFlight: null, unconfirmed: null };
    case 'signedOut':
      return { ...state, status: 'signedOut', inFlight: null };
    case 'tooLarge':
      return { ...state, status: 'tooLarge', inFlight: null, unconfirmed: null };
    case 'rebased':
      return {
        ...state,
        status: 'saved',
        baseVersion: event.version,
        latest: event.state,
        inFlight: null,
        attempt: 0,
        conflictVersion: null,
        issues: [],
        unconfirmed: null,
      };
    case 'serverState':
      if (state.status === 'trashed' && !event.trashed) {
        return { ...state, status: sameDraft(state.latest, event.state) ? 'idle' : 'dirty', attempt: 0 };
      }
      if ((state.status === 'idle' || state.status === 'saved') && event.version > state.baseVersion && !event.trashed) {
        return { ...state, baseVersion: event.version, latest: event.state };
      }
      return state;
  }
}
