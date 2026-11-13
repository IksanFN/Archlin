import { CaretRightIcon } from '@phosphor-icons/react/ssr';
import { Link } from '@tanstack/react-router';
import type { AriaAttributes, CSSProperties, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';
import { cn } from '../lib/utils';
import { DropIndicator } from './drop-indicator';

export type DropState = 'before' | 'after' | 'child' | null;

export interface TreeRowProps extends AriaAttributes {
  level: number;
  label: ReactNode;
  icon: ReactNode;
  meta?: ReactNode;
  expandable: boolean;
  expanded: boolean;
  selected: boolean;
  href?: string;
  onToggle?: () => void;
  actions?: ReactNode;
  dropState?: DropState;
  dropIndentPx?: number;
  dragging?: boolean;
  flash?: boolean;
  leaving?: boolean;
  muted?: boolean;
  tabIndex?: number;
  menuOpen?: boolean;
  id?: string;
  rowRef?: Ref<HTMLDivElement>;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}

function TreeRow({
  level,
  label,
  icon,
  meta,
  expandable,
  expanded,
  selected,
  href,
  onToggle,
  actions,
  dropState = null,
  dropIndentPx,
  dragging = false,
  flash = false,
  leaving = false,
  muted = false,
  tabIndex = -1,
  menuOpen = false,
  id,
  rowRef,
  onKeyDown,
  onContextMenu,
  children,
  ...aria
}: TreeRowProps) {
  const indent = 14 * Math.max(level - 1, 0) + (expandable ? 0 : 18);
  const space = level === 1;
  const indicatorIndent = dropIndentPx ?? indent;

  const body = (
    <>
      <span className={cn('flex size-[18px] shrink-0 items-center justify-center', selected ? 'text-fg' : 'text-fg-muted')}>
        {icon}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          space ? 'text-ui' : 'text-small',
          muted ? 'text-fg-muted' : selected ? 'text-fg' : 'text-fg-secondary',
        )}
      >
        {label}
      </span>
    </>
  );

  return (
    <div
      id={id}
      role="treeitem"
      aria-level={level}
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={selected}
      tabIndex={tabIndex}
      data-slot="tree-row"
      data-leaving={leaving ? 'true' : undefined}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      {...aria}
    >
      <div
        ref={rowRef}
        data-menu-open={menuOpen ? 'true' : undefined}
        className={cn(
          'enter-item group/tree relative flex h-11 items-center gap-2 rounded-md pr-2 transition-[color,background-color,transform,opacity] duration-[120ms] ease-out',
          'fine-hover:bg-overlay',
          '[@media(hover:hover)_and_(pointer:fine)]:active:scale-[0.98] motion-reduce:active:scale-100',
          selected ? 'bg-selected font-medium text-fg' : 'text-fg-secondary',
          dragging && 'opacity-50',
          flash && 'flash-selected',
        )}
        style={{ paddingLeft: indent } satisfies CSSProperties}
      >
        {expandable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="flex size-[18px] shrink-0 items-center justify-center text-fg-muted"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggle?.();
            }}
          >
            <CaretRightIcon
              aria-hidden="true"
              size={14}
              className={cn('transition-transform duration-200 ease-out motion-reduce:transition-none', expanded && 'rotate-90')}
            />
          </button>
        ) : null}
        {href === undefined ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">{body}</span>
        ) : (
          <Link to={href} tabIndex={-1} className="flex min-w-0 flex-1 items-center gap-2 outline-none">
            {body}
          </Link>
        )}
        {meta === undefined ? null : <span className="font-mono text-micro text-fg-muted">{meta}</span>}
        {actions === undefined ? null : (
          <span
            data-slot="tree-actions"
            className={cn(
              'relative z-10 ml-auto flex shrink-0 items-center',
              '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity [@media(hover:hover)]:duration-[120ms] [@media(hover:hover)]:ease-out',
              '[@media(hover:hover)]:group-hover/tree:opacity-100 [@media(hover:hover)]:group-focus-within/tree:opacity-100',
              '[@media(hover:hover)]:group-data-[menu-open=true]/tree:opacity-100',
            )}
          >
            {actions}
          </span>
        )}
        <DropIndicator instruction={dropState} indentPx={indicatorIndent} />
      </div>
      {children === undefined ? null : <div role="group">{children}</div>}
    </div>
  );
}

export { TreeRow };
