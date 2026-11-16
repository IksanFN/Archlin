import type { RestoreVersionResult, VersionDetail, VersionSummary } from '@archlin/modules-knowledge/shared';
import { toast } from '@archlin/ui/components/sonner';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KnowledgeClientError, useKnowledgeClient } from '../client';
import type { HistoryLabels } from './labels';

export type HistoryListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: VersionSummary[]; nextCursor: string | null; loadingMore: boolean };

export type HistoryDetailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; version: VersionDetail };

export type HistoryView = 'changes' | 'preview';

export interface VersionHistory {
  list: HistoryListState;
  selectedId: string | null;
  detail: HistoryDetailState;
  view: HistoryView;
  restoring: boolean;
  select(id: string | null): void;
  setView(view: HistoryView): void;
  loadMore(): void;
  reload(): void;
  retryDetail(): void;
  restore(): Promise<void>;
}

interface Options {
  entityId: string;
  open: boolean;
  // Bumped by the page after it saves a version from elsewhere (the page menu), so an open list shows it.
  reloadToken: number;
  // Resolves to the saved base version, or null while unsaved edits would make the restore conflict with itself.
  prepare: () => Promise<number | null>;
  onRestored: (result: RestoreVersionResult) => void;
  onError: (error: unknown) => void;
  labels: HistoryLabels;
}

function errorCode(error: unknown): string | null {
  return error instanceof KnowledgeClientError ? error.code : null;
}

// One place owns the list, the selected version and its detail so the side panel and the reading column stay in step.
export function useVersionHistory({ entityId, open, reloadToken, prepare, onRestored, onError, labels }: Options): VersionHistory {
  const client = useKnowledgeClient();
  const [list, setList] = useState<HistoryListState>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryDetailState>({ status: 'idle' });
  const [view, setView] = useState<HistoryView>('changes');
  const [restoring, setRestoring] = useState(false);
  const [listAttempt, setListAttempt] = useState(0);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const loadingMore = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    // A reload keeps the visible rows so the list does not flash while it refreshes.
    setList((state) => (state.status === 'ready' ? state : { status: 'loading' }));
    client.listVersions({ entityId, before: null }).then(
      (page) => {
        if (current) setList({ status: 'ready', items: page.items, nextCursor: page.nextCursor, loadingMore: false });
      },
      () => {
        if (current) setList({ status: 'error' });
      },
    );
    return () => {
      current = false;
    };
  }, [client, entityId, open, reloadToken, listAttempt]);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setDetail({ status: 'idle' });
      setView('changes');
    }
  }, [open]);

  useEffect(() => {
    if (selectedId === null) {
      setDetail({ status: 'idle' });
      return undefined;
    }
    let current = true;
    setDetail({ status: 'loading' });
    client.getVersion({ entityId, versionId: selectedId }).then(
      (version) => {
        if (current) setDetail({ status: 'ready', version });
      },
      () => {
        if (current) setDetail({ status: 'error' });
      },
    );
    return () => {
      current = false;
    };
  }, [client, entityId, selectedId, detailAttempt]);

  const loadMore = useCallback(() => {
    if (list.status !== 'ready' || list.nextCursor === null || loadingMore.current) return;
    const { nextCursor } = list;
    loadingMore.current = true;
    setList({ ...list, loadingMore: true });
    client.listVersions({ entityId, before: nextCursor }).then(
      (page) => {
        loadingMore.current = false;
        setList((state) =>
          state.status === 'ready'
            ? { status: 'ready', items: [...state.items, ...page.items], nextCursor: page.nextCursor, loadingMore: false }
            : state,
        );
      },
      (error: unknown) => {
        loadingMore.current = false;
        setList((state) => (state.status === 'ready' ? { ...state, loadingMore: false } : state));
        onError(error);
      },
    );
  }, [client, entityId, list, onError]);

  const reload = useCallback(() => setListAttempt((value) => value + 1), []);
  const retryDetail = useCallback(() => setDetailAttempt((value) => value + 1), []);

  const restore = useCallback(async (): Promise<void> => {
    if (selectedId === null || restoring) return;
    setRestoring(true);
    try {
      const base = await prepare();
      if (base === null) {
        toast(labels.unsavedFirst);
        return;
      }
      const result = await client.restoreVersion({ entityId, versionId: selectedId, baseVersion: base });
      onRestored(result);
      reload();
    } catch (error) {
      const code = errorCode(error);
      if (code === 'page_conflict') toast.error(labels.restoreConflict);
      else if (code === 'version_not_found') toast.error(labels.versionGone);
      else onError(error);
      reload();
    } finally {
      setRestoring(false);
    }
  }, [selectedId, restoring, prepare, labels, client, entityId, onRestored, reload, onError]);

  return { list, selectedId, detail, view, restoring, select: setSelectedId, setView, loadMore, reload, retryDetail, restore };
}
