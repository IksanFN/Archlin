import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';

function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-[skeleton-tone_1200ms_var(--ease-inout)_infinite] rounded-sm bg-surface-raised', className)}
      {...props}
    />
  );
}

export { Skeleton };
