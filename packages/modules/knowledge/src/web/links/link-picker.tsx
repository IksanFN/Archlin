import type { PageSuggestion } from '@archlin/modules-knowledge/shared';
import { FileTextIcon, PlusIcon } from '@phosphor-icons/react/ssr';
import type { SuggestionKeyDownProps } from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { LinkNodeKind } from './link-presentation';
import type { LinkLabels } from './page-editor-links';
import { pickerItems } from './picker-items';
import type { PickerItem } from './picker-items';

// A failed request reaches the picker as a row so it can tell it apart from "no matches".
export type PickerRow = PageSuggestion | { failed: true };

function isFailedRow(row: PickerRow): row is { failed: true } {
  return 'failed' in row;
}

export interface LinkPickerHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

export interface LinkPickerProps {
  rows: PickerRow[];
  loading: boolean;
  query: string;
  trigger: LinkNodeKind;
  command: (item: PickerItem) => void;
  labels: LinkLabels;
}

export const LinkPicker = forwardRef<LinkPickerHandle, LinkPickerProps>(function LinkPicker(
  { rows, loading, query, trigger, command, labels },
  ref,
) {
  const [index, setIndex] = useState(0);
  // Kept while the next request runs so typing does not flash the list empty.
  const settled = useRef<PageSuggestion[]>([]);
  const failed = !loading && rows.some(isFailedRow);
  if (!loading) settled.current = rows.filter((row): row is PageSuggestion => !isFailedRow(row));
  const items = pickerItems(settled.current, query, trigger);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    setIndex(0);
  }, [query, rows]);

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      const current = itemsRef.current;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (current.length === 0) return true;
        const step = event.key === 'ArrowUp' ? -1 : 1;
        setIndex((value) => (value + step + current.length) % current.length);
        return true;
      }
      if (event.key === 'Enter') {
        const chosen = current[indexRef.current];
        if (chosen !== undefined) command(chosen);
        return true;
      }
      return event.key === 'Escape';
    },
  }));

  const optionId = (position: number): string => `kb-link-option-${position}`;
  const settledCount = settled.current.length;

  return (
    <div className="kb-link-picker min-w-72 max-w-[min(24rem,calc(100vw-1rem))] rounded-lg border border-line-subtle bg-surface-raised p-1.5 shadow-overlay">
      <div
        role="listbox"
        aria-label={labels.pickerLabel}
        {...(items[index] === undefined ? {} : { 'aria-activedescendant': optionId(index) })}
      >
        {items.map((item, position) => {
          const selected = position === index;
          return (
            <button
              key={item.kind === 'page' ? item.suggestion.entityId : 'create'}
              type="button"
              id={optionId(position)}
              role="option"
              aria-selected={selected}
              className={`flex h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-small ${selected ? 'bg-selected text-fg' : 'text-fg-secondary'}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setIndex(position)}
              onClick={() => command(item)}
            >
              {item.kind === 'page' && item.suggestion.icon !== null ? (
                <span aria-hidden="true" className="w-4 shrink-0 text-center leading-none">
                  {item.suggestion.icon}
                </span>
              ) : item.kind === 'create' ? (
                <PlusIcon aria-hidden="true" size={16} className="shrink-0" />
              ) : (
                <FileTextIcon aria-hidden="true" size={16} className="shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {item.kind === 'page' ? item.suggestion.title : labels.createItem(item.title)}
              </span>
              {item.kind === 'page' ? (
                <span className="shrink-0 text-micro text-fg-muted">{item.suggestion.spaceName}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {loading && settledCount === 0 ? <div className="px-2.5 py-2 text-small text-fg-muted">{labels.searching}</div> : null}
      {failed ? <div className="px-2.5 py-2 text-small text-fg-muted">{labels.loadFailed}</div> : null}
      {!loading && !failed && items.length === 0 ? (
        <div className="px-2.5 py-2 text-small text-fg-muted">{labels.empty}</div>
      ) : null}
      <div role="status" aria-live="polite" className="sr-only">
        {loading || failed ? '' : labels.found(settledCount)}
      </div>
    </div>
  );
});
