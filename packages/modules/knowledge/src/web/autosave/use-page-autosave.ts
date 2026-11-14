import { canonicalJson } from '@archlin/modules-knowledge/shared';
import type { PageView, SavePageInput } from '@archlin/modules-knowledge/shared';
import type { SaveStatusState } from '@archlin/ui/components/save-status';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { KnowledgeClientError, type KnowledgeClient } from '../client';
import {
  AUTOSAVE_DEBOUNCE_MS,
  autosaveReducer,
  autosaveStateFromPage,
  classifySaveError,
  draftFromPage,
  exceedsSaveLimit,
  nextSave,
  retryDelayMs,
  saveStatusOf,
  type AutosaveEvent,
  type AutosaveState,
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

function eventFromError(error: unknown): AutosaveEvent {
  const online = typeof navigator === 'undefined' || navigator.onLine;
  return classifySaveError(error instanceof KnowledgeClientError ? error : null, online);
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
  adoptServer(next: PageView): boolean;
  adoptedCount: number;
  restoreDraft(draft: StoredDraft): void;
} {
  const [state, dispatch] = useReducer(autosaveReducer, page, autosaveStateFromPage);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pageRef = useRef(page);
  pageRef.current = page;
  const clientRef = useRef(client);
  clientRef.current = client;
  // Counts server states that replaced the editor content, so the editor can remount from the new latest.
  const [adoptedCount, setAdoptedCount] = useState(0);
  const cancelledRef = useRef(false);
  const lockRef = useRef(Promise.resolve());

  const apply = useCallback((event: AutosaveEvent): void => {
    stateRef.current = autosaveReducer(stateRef.current, event);
    dispatch(event);
  }, []);

  const persistDraft = useCallback((): void => {
    const storage = browserStorage();
    if (storage === null) return;
    const current = stateRef.current;
    if (current.status === 'idle' || current.status === 'saved') return;
    writeDraft(storage, {
      entityId: pageRef.current.entityId,
      tabId: TAB_ID,
      baseVersion: current.baseVersion,
      state: current.latest,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      persistDraft();
      cancelledRef.current = true;
    };
  }, [persistDraft]);

  const saveNow = useCallback(async (): Promise<void> => {
    const run = async (): Promise<void> => {
      const due = nextSave(stateRef.current);
      if (due === null) return;
      const sent = due.draft;
      const entityId = pageRef.current.entityId;
      const input = toSaveInput(entityId, due.baseVersion, sent);
      if (exceedsSaveLimit(input)) {
        apply({ type: 'tooLarge' });
        return;
      }
      apply({ type: 'saveStarted', draft: sent });
      try {
        const result = await clientRef.current.savePage(input);
        if (cancelledRef.current) return;
        apply({ type: 'saved', result, sent });
        dropDraftIfSent(entityId, sent);
      } catch (error) {
        if (cancelledRef.current) return;
        apply(eventFromError(error));
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
    // Latest is a dep so each edit while dirty restarts the 1000ms trailing timer.
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
  }, [state.status, state.latest, state.attempt, saveNow]);

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
    persistDraft();
    apply({ type: 'flush' });
    await saveNow();
    if (nextSave(stateRef.current) !== null) await saveNow();
  }, [apply, persistDraft, saveNow]);

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
      if (!cancelledRef.current) apply(eventFromError(error));
      throw error;
    }
  }, [apply]);

  const overwrite = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (current.conflictVersion === null) return;
    const sent = current.latest;
    const entityId = pageRef.current.entityId;
    const input = { ...toSaveInput(entityId, current.baseVersion, sent), seenVersion: current.conflictVersion };
    if (exceedsSaveLimit(input)) {
      apply({ type: 'tooLarge' });
      return;
    }
    try {
      const result = await clientRef.current.overwritePage(input);
      if (cancelledRef.current) return;
      apply({ type: 'saved', result, sent });
      dropDraftIfSent(entityId, sent);
    } catch (error) {
      if (cancelledRef.current) return;
      apply(eventFromError(error));
    }
  }, [apply]);

  const adoptServer = useCallback((next: PageView): boolean => {
    const before = stateRef.current.latest;
    apply({ type: 'serverState', version: next.version, state: draftFromPage(next), trashed: next.deletedAt !== null });
    const replaced = stateRef.current.latest !== before;
    if (replaced) setAdoptedCount((count) => count + 1);
    return replaced;
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
    adoptServer,
    adoptedCount,
    restoreDraft,
  };
}
