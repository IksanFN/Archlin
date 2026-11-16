import { Button } from '@archlin/ui/components/button';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { Skeleton } from '@archlin/ui/components/skeleton';
import type { RefObject } from 'react';
import { PanelFrame, PanelHeader } from '../panel/panel-frame';
import type { PanelLayout } from '../panel/panel-frame';
import type { HistoryLabels } from './labels';
import type { VersionHistory } from './use-version-history';
import { VersionList } from './version-list';

export function HistoryPanel({
  history,
  labels,
  trashed,
  open,
  onOpenChange,
  onSaveVersion,
  onPicked,
  returnFocus,
  layout,
  formatTime,
}: {
  history: VersionHistory;
  labels: HistoryLabels;
  trashed: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveVersion: () => void;
  // The sheet covers the reading column, so choosing a version closes it and the column shows the result.
  onPicked?: (() => void) | undefined;
  returnFocus?: RefObject<HTMLElement | null> | undefined;
  layout: PanelLayout;
  formatTime: (iso: string) => string;
}) {
  const { list } = history;
  const saveButton = (
    <Button variant="secondary" size="row" disabled={trashed} onClick={onSaveVersion}>
      {labels.saveVersion}
    </Button>
  );
  return (
    <PanelFrame layout={layout} open={open} onOpenChange={onOpenChange} title={labels.title} returnFocus={returnFocus}>
      <PanelHeader title={labels.title} action={saveButton} closeLabel={labels.closePanel} onClose={() => onOpenChange(false)} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {list.status === 'loading' ? (
          <div className="grid gap-2 px-1" aria-hidden="true">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : list.status === 'error' ? (
          <div className="grid gap-3 px-1">
            <InlineStatus variant="danger">{labels.loadFailed}</InlineStatus>
            <div>
              <Button variant="outline" size="row" onClick={history.reload}>
                {labels.retry}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <VersionList
              items={list.items}
              selectedId={history.selectedId}
              onSelect={(id) => {
                history.select(id);
                if (id !== null) onPicked?.();
              }}
              hasMore={list.nextCursor !== null}
              loadingMore={list.loadingMore}
              onLoadMore={history.loadMore}
              formatTime={formatTime}
              labels={labels}
            />
            {list.items.length === 0 ? <p className="mt-4 px-3 text-small text-fg-muted">{labels.empty}</p> : null}
          </>
        )}
      </div>
      <div className="grid shrink-0 gap-2 border-t border-line-subtle p-4">
        <Button
          className="w-full"
          loading={history.restoring}
          disabled={history.selectedId === null || trashed}
          onClick={() => void history.restore()}
        >
          {labels.restore}
        </Button>
        <p className="text-small text-fg-muted">{trashed ? labels.readOnly : labels.restoreNote}</p>
      </div>
    </PanelFrame>
  );
}
