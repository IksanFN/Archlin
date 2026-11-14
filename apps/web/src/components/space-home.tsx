import { Button } from '@archlin/ui/components/button';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { NumberFlip } from '@archlin/ui/components/number-flip';
import { toast } from '@archlin/ui/components/sonner';
import { cn } from '@archlin/ui/lib/utils';
import { EmptyState } from '@archlin/ui/shell/empty-state';
import { FileTextIcon, FolderSimpleIcon } from '@phosphor-icons/react/ssr';
import { Link, useRouter } from '@tanstack/react-router';
import { useState, type CSSProperties } from 'react';
import { NewPageMenu } from '~/components/new-page-menu';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { formatRelative } from '~/lib/format-time';
import { notifyTreeMutation } from '~/lib/tree-sync';
import type { SpaceHome as SpaceHomeData } from '~/server/functions/spaces';
import { unarchiveSpaceFn } from '~/server/functions/spaces';

const ROW_CLASS =
  'flex h-auto w-full items-start gap-3 border-b border-line-subtle py-3 transition-[color,background-color,transform] duration-[120ms] ease-out fine-hover:bg-overlay [@media(hover:hover)_and_(pointer:fine)]:active:scale-[0.98] motion-reduce:active:scale-100';

function rise(index: number): CSSProperties {
  const clamped = Math.min(index, 7);
  // Shared `.rise` steps 60ms per index; list rows stagger at 40ms without overriding reduced-motion delay.
  return { '--rise-index': (clamped * 40) / 60 } as CSSProperties;
}

function displayTitle(title: string): string {
  return title === '' ? messages.page.untitled : title;
}

export function SpaceHome({ space, rootPages, recent, now }: SpaceHomeData & { now: Date }) {
  const router = useRouter();
  const [restoring, setRestoring] = useState(false);
  const afterHeader = space.archivedAt === null ? 1 : 2;
  const recentStart = afterHeader + 1 + rootPages.length;

  async function restore(): Promise<void> {
    setRestoring(true);
    try {
      await unarchiveSpaceFn({ data: { id: space.id } });
      notifyTreeMutation();
      await router.invalidate();
    } catch (error) {
      const presentation = messageForError(error);
      if (presentation.kind === 'toast') toast.error(presentation.text);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col px-4 pt-6 pb-10 nav:px-12 nav:pt-14">
      <div className="mx-auto w-full max-w-[760px]">
        <header className="rise flex items-start justify-between gap-4" style={rise(0)}>
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-1 flex size-6 shrink-0 items-center justify-center text-[24px] leading-none">
              {space.icon ?? <FolderSimpleIcon aria-hidden="true" size={24} />}
            </span>
            <div className="min-w-0">
              <h1 className="text-h2 text-fg">{space.name}</h1>
              <p className="mt-1.5 text-small text-fg-muted">
                <NumberFlip value={space.pageCount} /> {messages.spaceHome.pagesSuffix}
              </p>
            </div>
          </div>
          <NewPageMenu
            spaceId={space.id}
            parentId={null}
            trigger={<Button>{messages.tree.newPage}</Button>}
            onCreated={() => notifyTreeMutation()}
          />
        </header>

        {space.archivedAt === null ? null : (
          <div className="rise mt-6 flex flex-col items-start gap-3" style={rise(1)}>
            <InlineStatus variant="attention">{messages.spaceHome.archived}</InlineStatus>
            <Button variant="secondary" size="row" loading={restoring} onClick={() => void restore()}>
              {messages.spaces.unarchive}
            </Button>
          </div>
        )}

        {rootPages.length === 0 ? (
          <EmptyState
            className="rise mt-10"
            style={rise(afterHeader)}
            icon={FileTextIcon}
            title={messages.spaceHome.emptyTitle}
            body={messages.spaceHome.emptyBody}
            actions={
              <NewPageMenu
                spaceId={space.id}
                parentId={null}
                trigger={<Button>{messages.tree.newPage}</Button>}
                onCreated={() => notifyTreeMutation()}
              />
            }
          />
        ) : (
          <>
            <section className="mt-10" aria-labelledby="space-home-roots">
              <div className="rise flex items-baseline justify-between pb-2" style={rise(afterHeader)}>
                <h2 id="space-home-roots" className="text-micro font-medium text-fg-muted">
                  {messages.spaceHome.roots}
                </h2>
                <span className="font-mono text-micro text-fg-muted">{rootPages.length}</span>
              </div>
              <ul>
                {rootPages.map((page, index) => {
                  const summary = page.summary !== null && page.summary.trim() !== '' ? page.summary : null;
                  const href = `/s/${space.slug}/p/${page.id}`;
                  return (
                    <li key={page.id}>
                      <Link to={href} className={cn('rise', ROW_CLASS)} style={rise(afterHeader + 1 + index)}>
                        <span className="flex size-[18px] shrink-0 items-center justify-center text-fg-muted">
                          {page.icon ?? <FileTextIcon aria-hidden="true" size={18} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-ui font-medium text-fg">{displayTitle(page.title)}</span>
                          {summary === null ? null : (
                            <span className="block truncate text-small text-fg-muted">{summary}</span>
                          )}
                        </span>
                        {page.descendantCount > 0 ? (
                          <span className="shrink-0 font-mono text-micro text-fg-muted">
                            {messages.spaceHome.pages(page.descendantCount)}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>

            {recent.length === 0 ? null : (
              <section className="mt-10" aria-labelledby="space-home-recent">
                <h2 id="space-home-recent" className="rise pb-2 text-micro font-medium text-fg-muted" style={rise(recentStart)}>
                  {messages.spaceHome.recent}
                </h2>
                <ul>
                  {recent.map((item, index) => {
                    const href = `/s/${item.spaceSlug}/p/${item.id}`;
                    return (
                      <li key={item.id}>
                        <Link to={href} className={cn('rise', ROW_CLASS)} style={rise(recentStart + 1 + index)}>
                          <span className="flex size-[18px] shrink-0 items-center justify-center text-fg-muted">
                            {item.icon ?? <FileTextIcon aria-hidden="true" size={18} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-ui font-medium text-fg">{displayTitle(item.title)}</span>
                            {item.path === '' ? null : (
                              <span className="block truncate text-micro text-fg-muted">{item.path}</span>
                            )}
                          </span>
                          <span className="shrink-0 text-micro text-fg-muted">
                            {formatRelative(new Date(item.updatedAt), now)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
