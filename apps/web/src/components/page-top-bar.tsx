import { Breadcrumb } from '@archlin/ui/components/breadcrumb';
import { Button } from '@archlin/ui/components/button';
import { SaveStatus, type SaveStatusState } from '@archlin/ui/components/save-status';
import { cn } from '@archlin/ui/lib/utils';
import type { Breadcrumb as Crumb } from '@archlin/platform/contracts';
import { StarIcon } from '@phosphor-icons/react/ssr';
import type { ReactNode } from 'react';
import { messages } from '~/i18n/id';

function displayTitle(title: string): string {
  return title === '' ? messages.page.untitled : title;
}

export function PageTopBar({
  breadcrumbs,
  spaceName,
  spaceSlug,
  title,
  saveState,
  invalidReason,
  saveAction = null,
  isStarred,
  onToggleStar,
  menu,
}: {
  breadcrumbs: readonly Crumb[];
  spaceName: string;
  spaceSlug: string;
  title: string;
  saveState: SaveStatusState;
  invalidReason: 'content' | 'properties';
  saveAction?: ReactNode;
  isStarred: boolean;
  onToggleStar: () => void;
  menu: ReactNode;
}) {
  const current = displayTitle(title);
  const { invalidContent, ...saveLabels } = messages.page.save;
  const labels = { ...saveLabels, invalid: invalidReason === 'content' ? invalidContent : saveLabels.invalid };
  const items = [
    { label: spaceName, href: `/s/${spaceSlug}` },
    ...breadcrumbs.map((crumb) => ({
      label: displayTitle(crumb.title),
      href: `/s/${spaceSlug}/p/${crumb.id}`,
    })),
  ];
  // Below 640px the full path overflows; keep the immediate parent so the user still knows where they are.
  const compactItems = items.slice(-1);

  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line-subtle px-4 nav:px-6">
      <div className="min-w-0 flex-1">
        <Breadcrumb className="hidden sm:block" items={items} current={current} label={messages.page.breadcrumb} />
        <Breadcrumb className="sm:hidden" items={compactItems} current={current} label={messages.page.breadcrumb} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <SaveStatus state={saveState} labels={labels} action={saveAction} />
        <Button
          variant="icon"
          size="icon-sm"
          aria-label={isStarred ? messages.favorites.remove : messages.favorites.add}
          aria-pressed={isStarred}
          className={cn('bg-transparent hover:bg-overlay', isStarred && 'bg-selected text-fg hover:bg-selected')}
          onClick={onToggleStar}
        >
          <StarIcon aria-hidden="true" size={18} weight={isStarred ? 'fill' : 'regular'} className={isStarred ? 'text-fg' : undefined} />
        </Button>
        {menu}
      </div>
    </div>
  );
}
