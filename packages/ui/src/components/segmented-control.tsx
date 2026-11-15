import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { segmentClipPath } from '../lib/motion';
import { cn } from '../lib/utils';

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  'aria-label': string;
  className?: string;
}

function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<T, HTMLButtonElement>());
  const [clipPath, setClipPath] = useState('inset(0 100% 0 0 round 9999px)');

  const updateClip = useCallback(() => {
    const container = containerRef.current;
    const segment = buttonRefs.current.get(value);
    if (container === null || segment === undefined) return;
    setClipPath(segmentClipPath(container.getBoundingClientRect(), segment.getBoundingClientRect()));
  }, [value]);

  useLayoutEffect(() => {
    updateClip();
    const container = containerRef.current;
    if (container === null) return;
    const observer = new ResizeObserver(updateClip);
    observer.observe(container);
    return () => observer.disconnect();
  }, [updateClip, options]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = options.findIndex((option) => option.value === value);
    if (index < 0) return;
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    const option = options[next];
    if (option === undefined) return;
    onValueChange(option.value);
    buttonRefs.current.get(option.value)?.focus();
  }

  return (
    <div
      ref={containerRef}
      data-slot="segmented-control"
      className={cn('relative h-10 rounded-pill bg-surface p-1', className)}
    >
      <div role="radiogroup" aria-label={ariaLabel} className="relative z-0 flex h-full" onKeyDown={onKeyDown}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              ref={(node) => {
                if (node === null) buttonRefs.current.delete(option.value);
                else buttonRefs.current.set(option.value, node);
              }}
              className="flex flex-1 items-center justify-center rounded-pill px-3 text-small text-fg-muted transition-transform duration-[120ms] ease-out enabled:active:scale-[0.98] motion-reduce:enabled:active:scale-100"
              onClick={() => onValueChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 transition-[clip-path] duration-200 ease-inout motion-reduce:transition-none"
        style={{ clipPath }}
      >
        <div className="flex h-full p-1">
          {options.map((option) => (
            <span
              key={option.value}
              className="flex flex-1 items-center justify-center rounded-pill bg-surface-hover px-3 text-small font-medium text-fg"
            >
              {option.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export { SegmentedControl };
