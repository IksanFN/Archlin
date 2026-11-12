import { cn } from '@archlin/ui/lib/utils';
import type { ReactNode } from 'react';

export function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="pb-8">
      <h2 className="mb-2 text-micro font-medium text-fg-muted">{label}</h2>
      {children}
    </section>
  );
}

interface SettingsRowProps {
  title: string;
  // Rendered under the title; pass a node when part of it needs its own colour.
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}

// Text on the left, one control on the right; stacked on a phone so the control keeps a full-width tap target.
export function SettingsRow({ title, description, children, className }: SettingsRowProps) {
  return (
    <div className={cn('flex flex-col gap-3 border-b border-line-subtle py-[18px] sm:flex-row sm:items-center sm:justify-between sm:gap-6', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-ui font-medium text-fg">{title}</p>
        {description === undefined ? null : <div className="text-small text-fg-muted">{description}</div>}
      </div>
      {children === undefined ? null : <div className="shrink-0">{children}</div>}
    </div>
  );
}
