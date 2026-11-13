import { SectionLabel } from '@archlin/ui/shell/section-label';
import { FileTextIcon } from '@phosphor-icons/react/ssr';
import { Link, useLocation } from '@tanstack/react-router';
import type { EntityRef } from '@archlin/platform/contracts';
import { messages } from '~/i18n/id';
import { cn } from '@archlin/ui/lib/utils';

export function FavoritesSection({ items }: { items: readonly EntityRef[] }) {
  const { pathname } = useLocation();
  if (items.length === 0) return null;
  return (
    <div>
      <SectionLabel>{messages.favorites.title}</SectionLabel>
      <ul className="flex flex-col">
        {items.map((item) => {
          const href = `/s/${item.spaceSlug}/p/${item.id}`;
          const selected = pathname === href || pathname.startsWith(`${href}?`);
          const untitled = item.title === '';
          return (
            <li key={item.id}>
              <Link
                to={href}
                className={cn(
                  'flex h-11 items-center gap-2 rounded-md pr-3 pl-[14px] text-small transition-[color,background-color,transform] duration-[120ms] ease-out fine-hover:bg-overlay',
                  '[@media(hover:hover)_and_(pointer:fine)]:active:scale-[0.98] motion-reduce:active:scale-100',
                  selected ? 'bg-selected font-medium text-fg' : 'text-fg-secondary',
                )}
              >
                <span className={cn('flex size-[18px] shrink-0 items-center justify-center', selected ? 'text-fg' : 'text-fg-muted')}>
                  {item.icon ?? <FileTextIcon aria-hidden="true" size={18} />}
                </span>
                <span className={cn('min-w-0 flex-1 truncate', untitled && 'text-fg-muted')}>
                  {untitled ? messages.tree.untitled : item.title}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
