import type { AttachmentView } from '@archlin/modules-knowledge/shared';
import { Button } from '@archlin/ui/components/button';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { Skeleton } from '@archlin/ui/components/skeleton';
import { toast } from '@archlin/ui/components/sonner';
import { useLeaving } from '@archlin/ui/lib/use-leaving';
import { EmptyState } from '@archlin/ui/shell/empty-state';
import { PaperclipIcon, UploadSimpleIcon } from '@phosphor-icons/react/ssr';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import type { KnowledgeClient } from '../client';
import { PanelFrame, PanelHeader } from '../panel/panel-frame';
import type { PanelLayout } from '../panel/panel-frame';
import type { AttachmentStore } from './attachment-store';
import { formatBytes, statusTone } from './attachment-labels';
import { AttachmentActions, AttachmentIcon, TONE_CLASS } from './attachment-view';
import type { AttachmentLabels } from './labels';

const POLL_MS = 5000;

type LoadState = 'loading' | 'error' | 'ready';

function AttachmentRow({
  view,
  labels,
  onRetry,
  leaving,
}: {
  view: AttachmentView;
  labels: AttachmentLabels;
  onRetry: (id: string) => void;
  leaving: boolean;
}) {
  return (
    <li
      data-leaving={leaving ? 'true' : undefined}
      className="flex flex-col gap-1 border-b border-line-subtle py-3"
    >
      <div className="flex items-center gap-3">
        <AttachmentIcon view={view} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-small font-medium text-fg" title={view.filename}>
            {view.filename}
          </p>
          <p className="font-mono text-[12px] leading-5 text-fg-muted">
            {formatBytes(view.size)}
            {' · '}
            {/* Keyed by status so a change while the panel is open fades in (M43). */}
            <span key={view.extraction} className={`page-enter ${TONE_CLASS[statusTone(view.extraction)]}`}>
              {labels.status[view.extraction]}
            </span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-8">
        <AttachmentActions view={view} labels={labels} />
        {view.extraction === 'failed' ? (
          <Button variant="ghost" size="row" onClick={() => onRetry(view.id)}>
            {labels.retry}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function AttachmentsPanel({
  pageId,
  store,
  open,
  onOpenChange,
  onUploadFiles,
  trashed,
  client,
  labels,
  layout,
  returnFocus,
}: {
  pageId: string;
  store: AttachmentStore;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Called with the picked files; the page puts them at the end of its content so they are referenced at once.
  onUploadFiles: (files: File[]) => void;
  trashed: boolean;
  client: Pick<KnowledgeClient, 'listAttachments' | 'trashOrphanAttachments' | 'retryExtraction'>;
  labels: AttachmentLabels;
  layout: PanelLayout;
  returnFocus?: RefObject<HTMLElement | null> | undefined;
}) {
  const all = useSyncExternalStore(store.subscribe, store.all, store.all);
  const [load, setLoad] = useState<LoadState>('loading');
  const [attempt, setAttempt] = useState(0);
  const [moving, setMoving] = useState(false);
  const leaving = useLeaving<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const visible = all.filter((view) => !view.trashed);
  const used = visible.filter((view) => view.referenced);
  const unused = visible.filter((view) => !view.referenced);
  const hasPending = visible.some((view) => view.extraction === 'pending');

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    client.listAttachments(pageId).then(
      (views) => {
        if (!current) return;
        store.replace(views);
        setLoad('ready');
      },
      () => {
        if (current) setLoad((state) => (state === 'ready' ? state : 'error'));
      },
    );
    return () => {
      current = false;
    };
  }, [client, pageId, store, open, attempt]);

  // Extraction runs in the worker, so a pending row is refreshed until it settles.
  useEffect(() => {
    if (!open || !hasPending) return undefined;
    const timer = window.setInterval(() => {
      client.listAttachments(pageId).then(
        (views) => store.replace(views),
        () => undefined,
      );
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [client, pageId, store, open, hasPending]);

  const retry = useCallback(
    (id: string) => {
      client.retryExtraction(id).then(
        (view) => store.upsert(view),
        () => toast.error(labels.loadFailed),
      );
    },
    [client, store, labels.loadFailed],
  );

  async function moveUnused(): Promise<void> {
    if (moving || unused.length === 0) return;
    const ids = unused.map((view) => view.id);
    setMoving(true);
    try {
      const { trashed: count } = await client.trashOrphanAttachments({ pageId, attachmentIds: ids });
      await Promise.all(ids.map((id) => leaving.leave(id)));
      store.replace(await client.listAttachments(pageId));
      toast(labels.movedUnused(count));
    } catch {
      toast.error(labels.loadFailed);
    } finally {
      setMoving(false);
    }
  }

  const uploadButton = (
    <Button variant="secondary" size="row" disabled={trashed} leadingIcon={<UploadSimpleIcon aria-hidden="true" size={16} />} onClick={() => fileInput.current?.click()}>
      {labels.upload}
    </Button>
  );

  return (
    <PanelFrame layout={layout} open={open} onOpenChange={onOpenChange} title={labels.title} returnFocus={returnFocus}>
      <PanelHeader title={labels.title} action={uploadButton} closeLabel={labels.closePanel} onClose={() => onOpenChange(false)} />
      <input
        ref={fileInput}
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length > 0) onUploadFiles(files);
        }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {load === 'loading' && visible.length === 0 ? (
          <div className="grid gap-3" aria-hidden="true">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : null}
        {load === 'error' && visible.length === 0 ? (
          <div className="grid gap-3">
            <InlineStatus variant="danger">{labels.loadFailed}</InlineStatus>
            <div>
              <Button variant="outline" size="row" onClick={() => setAttempt((value) => value + 1)}>
                {labels.retry}
              </Button>
            </div>
          </div>
        ) : null}
        {load === 'ready' && visible.length === 0 ? (
          <EmptyState
            icon={PaperclipIcon}
            title={labels.emptyTitle}
            body={labels.emptyBody}
            className="px-5 py-8"
            actions={
              <Button variant="secondary" size="row" disabled={trashed} onClick={() => fileInput.current?.click()}>
                {labels.upload}
              </Button>
            }
          />
        ) : null}
        {used.length > 0 ? (
          <ul>
            {used.map((view) => (
              <AttachmentRow key={view.id} view={view} labels={labels} onRetry={retry} leaving={leaving.isLeaving(view.id)} />
            ))}
          </ul>
        ) : null}
        {unused.length > 0 ? (
          <section aria-label={labels.unusedTitle} className="mt-6">
            <h3 className="flex items-baseline gap-2 font-mono text-micro uppercase text-fg-muted">
              {labels.unusedTitle}
              <span>{unused.length}</span>
            </h3>
            <p className="mt-2 text-small text-fg-muted">{labels.unusedBody}</p>
            <ul>
              {unused.map((view) => (
                <AttachmentRow key={view.id} view={view} labels={labels} onRetry={retry} leaving={leaving.isLeaving(view.id)} />
              ))}
            </ul>
            <Button variant="outline" className="mt-3" loading={moving} disabled={trashed} onClick={() => void moveUnused()}>
              {labels.moveUnused}
            </Button>
          </section>
        ) : null}
      </div>
    </PanelFrame>
  );
}
