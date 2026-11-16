import type { RestoreOutcome, TrashRoot } from '@archlin/platform/contracts';
import { Button } from '@archlin/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@archlin/ui/components/dialog';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { NumberFlip } from '@archlin/ui/components/number-flip';
import { Skeleton } from '@archlin/ui/components/skeleton';
import { toast } from '@archlin/ui/components/sonner';
import { cn } from '@archlin/ui/lib/utils';
import { useLeaving } from '@archlin/ui/lib/use-leaving';
import { EmptyState } from '@archlin/ui/shell/empty-state';
import { FileTextIcon, TrashIcon } from '@phosphor-icons/react/ssr';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { notifyTreeMutation } from '~/lib/tree-sync';
import { useAsyncData } from '~/lib/use-async-data';
import { emptyTrashFn, purgeFn, restoreFn, trashListFn } from '~/server/functions/trash';

const copy = messages.settings.trash;
const DAY_MS = 24 * 60 * 60 * 1000;

const loadTrash = () => trashListFn({ data: {} });

type Confirm = { kind: 'closed' } | { kind: 'purge'; item: TrashRoot } | { kind: 'empty' };

function displayTitle(title: string): string {
  return title === '' ? messages.page.untitled : title;
}

function pathOf(item: TrashRoot): string {
  const parent = item.parentTitle === null ? null : displayTitle(item.parentTitle);
  return copy.path(item.spaceName, parent);
}

// Ceil so a few seconds into a remaining day still counts as that day against the test clock.
function daysUntil(purgeAt: string, now: Date): number {
  const ms = new Date(purgeAt).getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / DAY_MS);
}

function pageCount(items: readonly TrashRoot[]): number {
  return items.reduce((sum, item) => sum + 1 + item.descendantCount, 0);
}

function attachmentCount(items: readonly TrashRoot[]): number {
  return items.reduce((sum, item) => sum + item.attachedCount, 0);
}

function restoreMessage(outcome: RestoreOutcome, item: TrashRoot): string {
  const text =
    item.parentTitle !== null && outcome.restoredToRoot
      ? copy.restoredToRoot(item.spaceName)
      : copy.restored(item.spaceName);
  return outcome.spaceArchived ? `${text}${copy.spaceArchived}` : text;
}

function reportFailure(failure: unknown): void {
  const presentation = messageForError(failure);
  if (presentation.kind === 'toast') toast.error(presentation.text);
}

export function TrashList() {
  const router = useRouter();
  const { state, reload } = useAsyncData(loadTrash);
  const leaving = useLeaving<string>();
  const [confirm, setConfirm] = useState<Confirm>({ kind: 'closed' });
  const [pending, setPending] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const items = (state.status === 'ready' ? state.data.items : []).filter((item) => !hiddenIds.has(item.rootId));
  const now = state.status === 'ready' ? new Date(state.data.nowIso) : new Date();
  const empty = items.length === 0;

  const restore = useCallback(
    async (item: TrashRoot) => {
      await leaving.leave(item.rootId);
      setHiddenIds((current) => {
        const next = new Set(current);
        next.add(item.rootId);
        return next;
      });
      try {
        const outcome = await restoreFn({ data: { rootId: item.rootId } });
        toast(restoreMessage(outcome, item), {
          action: {
            label: copy.open,
            onClick: () => {
              router.history.push(`/s/${outcome.spaceSlug}/p/${outcome.entityId}`);
            },
          },
        });
        notifyTreeMutation();
        void router.invalidate();
        reload();
      } catch (failure) {
        setHiddenIds((current) => {
          const next = new Set(current);
          next.delete(item.rootId);
          return next;
        });
        reportFailure(failure);
        reload();
      }
    },
    [leaving, reload, router],
  );

  async function purge(item: TrashRoot): Promise<void> {
    setPending(true);
    try {
      await purgeFn({ data: { rootId: item.rootId } });
      setConfirm({ kind: 'closed' });
      notifyTreeMutation();
      void router.invalidate();
      reload();
    } catch (failure) {
      reportFailure(failure);
    } finally {
      setPending(false);
    }
  }

  async function emptyTrash(): Promise<void> {
    setPending(true);
    try {
      await emptyTrashFn({ data: {} });
      setConfirm({ kind: 'closed' });
      notifyTreeMutation();
      void router.invalidate();
      reload();
    } catch (failure) {
      reportFailure(failure);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-10 px-4 py-6 md:p-12">
      <header className="flex max-w-[560px] flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-h3 text-fg md:text-h2">{copy.title}</h1>
          <NumberFlip value={items.length} className="text-h3 text-fg-muted md:text-h2" />
        </div>
        <p className="text-body text-fg-muted">{copy.description}</p>
        <Button
          variant="outline"
          className="self-start text-danger"
          disabled={empty || state.status !== 'ready'}
          onClick={() => setConfirm({ kind: 'empty' })}
        >
          {copy.empty}
        </Button>
      </header>

      <div className="max-w-[640px]">
        {state.status === 'loading' ? (
          <div role="status" aria-label={messages.common.loading} className="flex flex-col gap-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div className="flex flex-col gap-3">
            <InlineStatus variant="danger">{copy.loadFailed}</InlineStatus>
            <Button variant="outline" size="row" className="self-start" onClick={reload}>
              {messages.common.retry}
            </Button>
          </div>
        ) : null}
        {state.status === 'ready' && empty ? (
          <EmptyState icon={TrashIcon} title={copy.emptyStateTitle} body={copy.emptyStateBody} />
        ) : null}
        {state.status === 'ready' && !empty ? (
          <ul>
            {items.map((item) => {
              const days = daysUntil(item.purgeAt, now);
              return (
                <li
                  key={item.rootId}
                  data-leaving={leaving.isLeaving(item.rootId) ? 'true' : undefined}
                  className="flex flex-col gap-3 border-b border-line-subtle py-[18px] sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center text-fg-muted">
                      {item.icon ?? <FileTextIcon aria-hidden="true" size={18} />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-ui font-medium text-fg">{displayTitle(item.title)}</p>
                      <p className="text-micro text-fg-muted">
                        {pathOf(item)}
                        {item.descendantCount > 0 ? ` ${copy.subpages(item.descendantCount)}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    <span className={cn('text-micro text-fg-muted', days <= 3 && 'text-attention')}>
                      {copy.daysLeft(days)}
                    </span>
                    <Button variant="secondary" size="row" onClick={() => void restore(item)}>
                      {copy.restore}
                    </Button>
                    <Button variant="ghost" size="row" className="text-danger" onClick={() => setConfirm({ kind: 'purge', item })}>
                      {copy.purge}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <Dialog open={confirm.kind !== 'closed'} onOpenChange={(open) => (open ? undefined : setConfirm({ kind: 'closed' }))}>
        <DialogContent>
          {confirm.kind === 'purge' ? (
            <>
              <DialogHeader>
                <DialogTitle>{copy.purgeTitle(displayTitle(confirm.item.title))}</DialogTitle>
                <DialogDescription>{copy.purgeBody(confirm.item.descendantCount)}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{messages.common.cancel}</Button>
                </DialogClose>
                <Button variant="danger" loading={pending} onClick={() => void purge(confirm.item)}>
                  {copy.purge}
                </Button>
              </DialogFooter>
            </>
          ) : null}
          {confirm.kind === 'empty' ? (
            <>
              <DialogHeader>
                <DialogTitle>{copy.emptyTitle}</DialogTitle>
                <DialogDescription>{copy.emptyBody(pageCount(items), attachmentCount(items))}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{messages.common.cancel}</Button>
                </DialogClose>
                <Button variant="danger" loading={pending} onClick={() => void emptyTrash()}>
                  {copy.purge}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
