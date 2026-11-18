import type { SuggestionKeyDownProps } from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { EditorLabels } from './labels';
import type { SlashItem } from './slash-items';

export interface SlashMenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

export interface SlashMenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  labels: EditorLabels;
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(function SlashMenu({ items, command, labels }, ref) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  indexRef.current = index;

  useEffect(() => {
    setIndex(0);
  }, [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      if (event.key === 'ArrowUp') {
        if (items.length === 0) return true;
        setIndex((current) => (current - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        if (items.length === 0) return true;
        setIndex((current) => (current + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        const item = items[indexRef.current];
        if (item !== undefined) command(item);
        return true;
      }
      if (event.key === 'Escape') return true;
      return false;
    },
  }));

  const active = items[index];
  const activeId = active === undefined ? undefined : `slash-item-${active.id}`;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const option = menu?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!menu || !option) return;
    function reveal() {
      if (!menu || !option) return;
      const top = menu.getBoundingClientRect().top + menu.clientTop;
      const bounds = option.getBoundingClientRect();
      if (bounds.top < top) menu.scrollTop += bounds.top - top;
      else if (bounds.bottom > top + menu.clientHeight) menu.scrollTop += bounds.bottom - top - menu.clientHeight;
    }
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [activeId]);

  return (
    <div
      ref={menuRef}
      style={{ maxHeight: 'var(--slash-menu-height)', overflowY: 'auto', overscrollBehavior: 'contain' }}
      id="kb-slash-menu"
      role="listbox"
      className="kb-slash-menu min-w-56 rounded-lg border border-line-subtle bg-surface-raised p-1.5 shadow-overlay"
      {...(activeId === undefined ? {} : { 'aria-activedescendant': activeId })}
    >
      {items.length === 0 ? (
        <div className="px-2.5 py-2 text-small text-fg-muted">{labels.slashEmpty}</div>
      ) : (
        items.map((item, itemIndex) => {
          const selected = itemIndex === index;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              id={`slash-item-${item.id}`}
              role="option"
              aria-selected={selected}
              className={`flex h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-small ${selected ? 'bg-selected text-fg' : 'text-fg-secondary'}`}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onMouseEnter={() => {
                setIndex(itemIndex);
              }}
              onClick={() => {
                command(item);
              }}
            >
              <Icon aria-hidden="true" size={16} />
              {item.label}
            </button>
          );
        })
      )}
    </div>
  );
});
