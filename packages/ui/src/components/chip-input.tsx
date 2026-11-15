import { XIcon } from '@phosphor-icons/react/ssr';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { addChips } from '../lib/chips';
import { useLeaving } from '../lib/use-leaving';
import { cn } from '../lib/utils';
import { fieldSurface } from './input';

export interface ChipInputProps {
  values: readonly string[];
  onChange(values: string[]): void;
  max: number;
  // Longer chips are cut to this length when added, so the server never has to reject them.
  maxChipLength?: number;
  disabled?: boolean;
  // Shown before each chip, such as # for tags; the value itself stays unprefixed.
  chipPrefix?: string;
  labels: { input: string; remove(value: string): string; limit: string };
  suggestions?: readonly string[];
  onQueryChange?(query: string): void;
  id?: string;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: true | undefined;
  'data-shake'?: 'true';
}

// labels.input is the placeholder; the visible field label comes from the FormField that owns `id`.
function ChipInput({
  values,
  onChange,
  max,
  maxChipLength,
  disabled = false,
  chipPrefix,
  labels,
  suggestions = [],
  onQueryChange,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  'data-shake': dataShake,
}: ChipInputProps) {
  const listId = useId();
  const leaving = useLeaving<string>();
  const latest = useRef(values);
  // Read after the leave animation, when the values the caller holds may have moved on.
  useEffect(() => {
    latest.current = values;
  }, [values]);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const [limitHit, setLimitHit] = useState(false);

  const taken = new Set(values.map((value) => value.toLowerCase()));
  const options = suggestions.filter((value) => !taken.has(value.toLowerCase()));
  const open = focused && !dismissed && query.trim() !== '' && options.length > 0;
  const activeId = open && active >= 0 ? `${listId}-${active}` : undefined;

  function updateQuery(next: string): void {
    setQuery(next);
    setActive(-1);
    setDismissed(false);
    onQueryChange?.(next);
  }

  function commit(raw: string): void {
    const bounded =
      maxChipLength === undefined
        ? raw
        : raw
            .split(',')
            .map((part) => part.trim().slice(0, maxChipLength))
            .join(',');
    const result = addChips(latest.current, bounded, max);
    setLimitHit(result.rejected === 'limit');
    if (result.values.length !== latest.current.length) onChange(result.values);
    updateQuery('');
  }

  async function remove(value: string): Promise<void> {
    await leaving.leave(value);
    setLimitHit(false);
    onChange(latest.current.filter((item) => item !== value));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value;
    if (next.includes(',')) commit(next);
    else updateQuery(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      const picked = open && active >= 0 ? options[active] : undefined;
      commit(picked ?? query);
    } else if (event.key === 'Backspace' && query === '') {
      const last = latest.current.at(-1);
      if (last !== undefined) void remove(last);
    } else if (event.key === 'ArrowDown' && options.length > 0) {
      event.preventDefault();
      setDismissed(false);
      setActive((current) => (current + 1) % options.length);
    } else if (event.key === 'ArrowUp' && options.length > 0) {
      event.preventDefault();
      setDismissed(false);
      setActive((current) => (current <= 0 ? options.length - 1 : current - 1));
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    }
  }

  return (
    <div data-slot="chip-input">
      <div
        {...(dataShake === undefined ? {} : { 'data-shake': dataShake })}
        className={cn('flex min-h-10 flex-wrap items-center gap-1.5 px-2 py-1.5', fieldSurface)}
      >
        {values.map((value) => (
          <span
            key={value}
            data-leaving={leaving.isLeaving(value) ? 'true' : undefined}
            className="enter-item inline-flex h-7 max-w-full items-center gap-0.5 rounded-pill border border-line-strong pl-2.5 pr-0.5 text-[13px] text-fg-secondary"
          >
            <span className="truncate">
              {chipPrefix}
              {value}
            </span>
            <button
              type="button"
              aria-label={labels.remove(value)}
              disabled={disabled}
              onClick={() => void remove(value)}
              className="flex size-6 shrink-0 items-center justify-center rounded-pill text-fg-muted transition-colors duration-[120ms] ease-out enabled:hover:bg-overlay enabled:hover:text-fg"
            >
              <XIcon aria-hidden="true" size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder={values.length === 0 ? labels.input : undefined}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (query.trim() !== '') commit(query);
          }}
          className="h-7 min-w-24 flex-1 bg-transparent px-1 text-small outline-none placeholder:text-fg-muted"
        />
      </div>
      {limitHit ? (
        <p role="status" className="mt-1.5 text-micro text-attention">
          {labels.limit}
        </p>
      ) : null}
      <ul
        id={listId}
        role="listbox"
        hidden={!open}
        className="mt-1 max-h-44 overflow-auto rounded-md border border-line-subtle bg-surface-raised p-1"
      >
        {open
          ? options.map((option, index) => (
              <li
                key={option}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // Mouse down would blur the input and commit the half-typed query before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(option)}
                className={cn(
                  'cursor-pointer rounded-sm px-2.5 py-1.5 text-small text-fg-secondary',
                  index === active ? 'bg-surface-hover text-fg' : 'hover:bg-overlay',
                )}
              >
                {option}
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}

export { ChipInput };
