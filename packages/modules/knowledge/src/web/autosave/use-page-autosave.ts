import { canonicalJson } from '@archlin/modules-knowledge/shared';
import type { PageView, SavePageInput } from '@archlin/modules-knowledge/shared';
import type { SaveStatusState } from '@archlin/ui/components/save-status';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { KnowledgeClientError, type KnowledgeClient } from '../client';
import {
  AUTOSAVE_DEBOUNCE_MS,
  autosaveReducer,
  autosaveStateFromPage,
  draftFromPage,
  retryDelayMs,
  saveStatusOf,
  type AutosaveEvent,
  type AutosaveState,
  type AutosaveStatus,
  type PageDraftState,
} from './autosave-machine';
import { browserStorage, readDrafts, removeDraft, TAB_ID, writeDraft, type StoredDraft } from './draft-store';

const DRAFT_WRITE_MS = 300;

function toSaveInput(entityId: string, baseVersion: number, draft: PageDraftState): SavePageInput {
  return {
    entityId,
    baseVersion,
    title: draft.title,
    content: draft.content,
    context: draft.context,
    // Draft state is untyped JSON; the server validates the payload on write.
    properties: draft.properties as SavePageInput['properties'],
  };
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

function eventFromError(error: unknown, fallbackVersion: number): AutosaveEvent {
  if (error instanceof KnowledgeClientError) {
    if (error.status === 409 && error.code === 'page_conflict') {
      return { type: 'conflict', currentVersion: currentVersionOf(error.details) ?? fallbackVersion };
    }
    if (error.status === 409 && error.code === 'page_in_trash') return { type: 'trashed' };
    if (error.status === 422) return { type: 'invalid', issues: issuesOf(error.details) };
    if (error.status >= 500) return { type: 'failed', kind: 'server' };
    return { type: 'failed', kind: 'server' };
  }
  const online = typeof navigator === 'undefined' || navigator.onLine;
  return { type: 'failed', kind: online ? 'network' : 'offline' };
}

function needsSave(status: AutosaveStatus): boolean {
  return status === 'dirty' || status === 'error' || status === 'offline';
}

function dropDraftIfSent(entityId: string, sent: PageDraftState): void {
  const storage = browserStorage();
  if (storage === null) return;
  const mine = readDrafts(storage, entityId).find((draft) => draft.tabId === TAB_ID);
  if (mine !== undefined && canonicalJson(sent) === canonicalJson(mine.state)) {
    removeDraft(storage, entityId, TAB_ID);
  }
}

export function usePageAutosave({ page, client }: { page: PageView; client: KnowledgeClient }): {
  state: AutosaveState;
  saveStatus: SaveStatusState;
  update(patch: Partial<PageDraftState>): void;
  flush(): Promise<void>;
  loadLatest(): Promise<PageView>;
  overwrite(): Promise<void>;
  markRestored(): void;
  restoreDraft(draft: StoredDraft): void;
} {
  const [state, dispatch] = useReducer(autosaveReducer, page, autosaveStateFromPage);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pageRef = useRef(page);
  pageRef.current = page;
  const clientRef = useRef(client);
  clientRef.current = client;
  const cancelledRef = useRef(false);
  const lockRef = useRef(Promise.resolve());

  const apply = useCallback((event: AutosaveEvent): void => {
    stateRef.current = autosaveReducer(stateRef.current, event);
    dispatch(event);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const saveNow = useCallback(async (): Promise<void> => {
    const run = async (): Promise<void> => {
      const current = stateRef.current;
      if (!needsSave(current.status)) return;
      apply({ type: 'saveStarted' });
      const sent = stateRef.current.latest;
      const baseVersion = stateRef.current.baseVersion;
      const entityId = pageRef.current.entityId;
      try {
        const result = await clientRef.current.savePage(toSaveInput(entityId, baseVersion, sent));
        if (cancelledRef.current) return;
        apply({ type: 'saved', result, sent });
        dropDraftIfSent(entityId, sent);
      } catch (error) {
        if (cancelledRef.current) return;
        apply(eventFromError(error, stateRef.current.baseVersion));
      }
    };
    const pending = lockRef.current.then(run, run);
    lockRef.current = pending.then(
      () => undefined,
      () => undefined,
    );
    await pending;
  }, [apply]);

  useEffect(() => {
    if (state.status === 'dirty') {
      const timer = globalThis.setTimeout(() => {
        void saveNow();
      }, AUTOSAVE_DEBOUNCE_MS);
      return () => globalThis.clearTimeout(timer);
    }
    if (state.status === 'error' || state.status === 'offline') {
      const timer = globalThis.setTimeout(() => {
        void saveNow();
      }, retryDelayMs(state.attempt));
      return () => globalThis.clearTimeout(timer);
    }
    return undefined;
  }, [state.status, state.attempt, saveNow]);

  useEffect(() => {
    function onOnline(): void {
      const status = stateRef.current.status;
      if (status === 'offline' || status === 'error') void saveNow();
    }
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [saveNow]);

  useEffect(() => {
    if (state.status === 'idle' || state.status === 'saved') return undefined;
    const timer = globalThis.setTimeout(() => {
      const storage = browserStorage();
      if (storage === null) return;
      writeDraft(storage, {
        entityId: page.entityId,
        tabId: TAB_ID,
        baseVersion: state.baseVersion,
        state: state.latest,
        updatedAt: new Date().toISOString(),
      });
    }, DRAFT_WRITE_MS);
    return () => globalThis.clearTimeout(timer);
  }, [page.entityId, state.baseVersion, state.latest, state.status]);

  const update = useCallback((patch: Partial<PageDraftState>): void => {
    const latest = stateRef.current.latest;
    const next = { ...latest, ...patch };
    if (canonicalJson(next) === canonicalJson(latest)) return;
    apply({ type: 'edit', state: next });
  }, [apply]);

  const flush = useCallback(async (): Promise<void> => {
    apply({ type: 'flush' });
    await saveNow();
    if (needsSave(stateRef.current.status)) await saveNow();
  }, [apply, saveNow]);

  const loadLatest = useCallback(async (): Promise<PageView> => {
    const current = stateRef.current;
    const entityId = pageRef.current.entityId;
    try {
      await clientRef.current.saveConflictCopy(toSaveInput(entityId, current.baseVersion, current.latest));
      const screen = await clientRef.current.getPage(entityId);
      if (!cancelledRef.current) {
        apply({ type: 'rebased', version: screen.page.version, state: draftFromPage(screen.page) });
        const storage = browserStorage();
        if (storage !== null) removeDraft(storage, entityId, TAB_ID);
      }
      return screen.page;
    } catch (error) {
      if (!cancelledRef.current) apply(eventFromError(error, stateRef.current.baseVersion));
      throw error;
    }
  }, [apply]);

  const overwrite = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (current.conflictVersion === null) return;
    const sent = current.latest;
    const entityId = pageRef.current.entityId;
    try {
      const result = await clientRef.current.overwritePage({
        ...toSaveInput(entityId, current.baseVersion, sent),
        seenVersion: current.conflictVersion,
      });
      if (cancelledRef.current) return;
      apply({ type: 'saved', result, sent });
      dropDraftIfSent(entityId, sent);
    } catch (error) {
      if (cancelledRef.current) return;
      apply(eventFromError(error, stateRef.current.baseVersion));
    }
  }, [apply]);

  const markRestored = useCallback((): void => {
    apply({ type: 'restored' });
  }, [apply]);

  const restoreDraft = useCallback((draft: StoredDraft): void => {
    apply({ type: 'rebased', version: draft.baseVersion, state: draft.state });
    apply({ type: 'edit', state: draft.state });
  }, [apply]);

  return {
    state,
    saveStatus: saveStatusOf(state.status),
    update,
    flush,
    loadLatest,
    overwrite,
    markRestored,
    restoreDraft,
  };
}
