import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';

interface BadgeProps extends ComponentProps<'span'> {
  // Colours the 6px dot; leave unset for a plain label.
  dot?: 'success';
}

function Badge({ className, dot, children, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-pill bg-overlay px-2 text-micro font-medium text-fg-secondary', className)}
      {...props}
    >
      {dot === undefined ? null : <span aria-hidden="true" className="size-1.5 rounded-pill bg-success" />}
      {children}
    </span>
  );
}

export { Badge };
