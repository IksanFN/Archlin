import type { SuggestionKeyDownProps } from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
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

  return (
    <div
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
