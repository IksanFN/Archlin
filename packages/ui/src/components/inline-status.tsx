import { CheckIcon, InfoIcon, WarningIcon } from '@phosphor-icons/react/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

const VARIANTS: Record<'success' | 'attention' | 'danger' | 'info', { icon: Icon; tone: string }> = {
  success: { icon: CheckIcon, tone: 'text-success' },
  attention: { icon: WarningIcon, tone: 'text-attention' },
  danger: { icon: WarningIcon, tone: 'text-danger' },
  info: { icon: InfoIcon, tone: 'text-info' },
};

interface InlineStatusProps {
  variant: keyof typeof VARIANTS;
  children: ReactNode;
  className?: string;
}

// Only the failure variant interrupts a screen reader; the others are polite status text.
function InlineStatus({ variant, children, className }: InlineStatusProps) {
  const { icon: StateIcon, tone } = VARIANTS[variant];
  return (
    <div
      data-slot="inline-status"
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-md bg-surface px-3 py-2.5 text-small text-fg-secondary', className)}
    >
      <StateIcon aria-hidden="true" size={18} className={cn('mt-px shrink-0', tone)} />
      <span>{children}</span>
    </div>
  );
}

export { InlineStatus };
