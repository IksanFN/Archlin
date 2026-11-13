import { cn } from '../lib/utils';

export interface DropIndicatorProps {
  instruction: 'before' | 'after' | 'child' | null;
  indentPx: number;
}

function DropIndicator({ instruction, indentPx }: DropIndicatorProps) {
  if (instruction === null) return null;
  if (instruction === 'child') {
    return (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md bg-selected transition-[opacity,transform] duration-[120ms] ease-out"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute right-0 h-0.5 bg-inverse transition-[opacity,transform] duration-[120ms] ease-out',
        instruction === 'before' ? 'top-0' : 'bottom-0',
      )}
      style={{ left: indentPx }}
    >
      <span className="absolute top-1/2 left-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-inverse" />
    </span>
  );
}

export { DropIndicator };
