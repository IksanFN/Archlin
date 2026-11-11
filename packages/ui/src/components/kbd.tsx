import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';

function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn('inline-flex h-5 items-center rounded-sm border border-line-subtle bg-overlay px-1.5 font-mono text-[11px] text-fg-muted', className)}
      {...props}
    />
  );
}

export { Kbd };
