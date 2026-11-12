import type { Icon } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../lib/utils';

interface EmptyStateProps {
  icon: Icon;
  title: string;
  body: string;
  actions?: ReactNode;
  // The screen's own h1 may be the date or a section title, so a page-level empty state defaults to h2.
  headingLevel?: 1 | 2;
  className?: string;
  style?: CSSProperties;
}

function EmptyState({ icon: StateIcon, title, body, actions, headingLevel = 2, className, style }: EmptyStateProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <div style={style} className={cn('flex flex-col items-center rounded-lg border border-line px-8 py-12 text-center', className)}>
      <span className="flex size-12 items-center justify-center rounded-pill bg-surface-raised text-fg-secondary">
        <StateIcon aria-hidden="true" size={22} />
      </span>
      <Heading className="mt-5 text-title text-fg">{title}</Heading>
      <p className="mt-2 max-w-sm text-small text-fg-muted">{body}</p>
      {actions === undefined ? null : <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}

export { EmptyState };
