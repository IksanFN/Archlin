import type { VersionSummary } from '@archlin/modules-knowledge/shared';
import { Button } from '@archlin/ui/components/button';
import { cn } from '@archlin/ui/lib/utils';
import type { HistoryLabels } from './labels';
import { reasonLabel } from './history-model';

export function VersionList({
  items,
  selectedId,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
  formatTime,
  labels,
}: {
  items: readonly VersionSummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  formatTime: (iso: string) => string;
  labels: HistoryLabels;
}) {
  const rowClass = (selected: boolean): string =>
    cn(
      'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-[120ms] ease-out',
      selected ? 'bg-surface-raised' : 'bg-transparent fine-hover:bg-overlay',
    );
  const dotClass = (selected: boolean): string =>
    cn('mt-[7px] size-2 shrink-0 rounded-full', selected ? 'bg-fg' : 'bg-fg-disabled');

  return (
    <ul className="grid gap-0.5">
      <li>
        <button type="button" className={rowClass(selectedId === null)} aria-current={selectedId === null ? 'true' : undefined} onClick={() => onSelect(null)}>
          <span aria-hidden="true" className="mt-[7px] size-2 shrink-0 rounded-full bg-success" />
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className="text-small font-medium text-fg">{labels.current}</span>
            <span className="font-mono text-micro uppercase text-fg-muted">{labels.currentTag}</span>
          </span>
        </button>
      </li>
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <li key={item.id}>
            <button type="button" className={rowClass(selected)} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(item.id)}>
              <span aria-hidden="true" className={dotClass(selected)} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-small font-medium text-fg">{formatTime(item.createdAt)}</span>
                <span className="font-mono text-micro uppercase text-fg-muted">{reasonLabel(item.reason, labels)}</span>
                {item.label === null ? null : <span className="truncate text-small text-fg-secondary">“{item.label}”</span>}
              </span>
            </button>
          </li>
        );
      })}
      {hasMore ? (
        <li className="pt-1">
          <Button variant="ghost" size="row" loading={loadingMore} onClick={onLoadMore}>
            {labels.loadMore}
          </Button>
        </li>
      ) : null}
    </ul>
  );
}
