import { canonicalJson } from '@archlin/modules-knowledge/shared';
import type { ContextFields, PageView, SaveResult } from '@archlin/modules-knowledge/shared';
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

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict' | 'trashed' | 'invalid';

export interface AutosaveState {
  status: AutosaveStatus;
  baseVersion: number;
  latest: PageDraftState;
  inFlight: PageDraftState | null;
  attempt: number;
  savedAt: string | null;
  conflictVersion: number | null;
  issues: readonly { path: string; message: string }[];
}

export type AutosaveEvent =
  | { type: 'edit'; state: PageDraftState }
  | { type: 'flush' }
  | { type: 'saveStarted' }
  | { type: 'saved'; result: SaveResult; sent: PageDraftState }
  | { type: 'failed'; kind: 'network' | 'offline' | 'server' }
  | { type: 'conflict'; currentVersion: number }
  | { type: 'trashed' }
  | { type: 'invalid'; issues: readonly { path: string; message: string }[] }
  | { type: 'rebased'; version: number; state: PageDraftState }
  | { type: 'restored' };

const STOPPED: ReadonlySet<AutosaveStatus> = new Set(['conflict', 'trashed', 'invalid']);

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
      if (state.status === 'conflict') return { ...state, latest: event.state };
      if (state.status === 'trashed') return { ...state, latest: event.state };
      if (state.status === 'saving') return { ...state, latest: event.state };
      return { ...state, status: 'dirty', latest: event.state, issues: [], attempt: 0 };
    case 'flush':
      return state;
    case 'saveStarted':
      if (STOPPED.has(state.status) || state.status === 'saving' || state.status === 'idle' || state.status === 'saved') {
        return state;
      }
      return { ...state, status: 'saving', inFlight: state.latest };
    case 'saved': {
      const next: AutosaveState = {
        ...state,
        baseVersion: event.result.version,
        savedAt: event.result.savedAt,
        inFlight: null,
        attempt: 0,
        conflictVersion: null,
        issues: [],
      };
      if (sameDraft(event.sent, state.latest)) return { ...next, status: 'saved' };
      return { ...next, status: 'dirty' };
    }
    case 'failed':
      if (STOPPED.has(state.status)) return state;
      return {
        ...state,
        status: event.kind === 'offline' ? 'offline' : 'error',
        attempt: state.attempt + 1,
        inFlight: null,
      };
    case 'conflict':
      return { ...state, status: 'conflict', conflictVersion: event.currentVersion, inFlight: null };
    case 'trashed':
      return { ...state, status: 'trashed', inFlight: null };
    case 'invalid':
      return { ...state, status: 'invalid', issues: event.issues, inFlight: null };
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
      };
    case 'restored':
      if (state.status !== 'trashed') return state;
      return { ...state, status: 'dirty', attempt: 0 };
  }
}
