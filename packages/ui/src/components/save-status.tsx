import { WarningIcon } from '@phosphor-icons/react/ssr';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export type SaveStatusState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error'
  | 'offline'
  | 'conflict'
  | 'invalid'
  | 'signedOut'
  | 'tooLarge';

interface SaveStatusProps {
  state: SaveStatusState;
  labels: Record<Exclude<SaveStatusState, 'idle'>, string>;
  action?: ReactNode;
  className?: string;
}

function SavedCheck() {
  return (
    <svg viewBox="0 0 18 18" className="size-3.5 text-success" aria-hidden="true">
      <path
        d="M3.5 9.5l3.5 3.5 7.5-8"
        pathLength={14}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="[stroke-dasharray:14] [stroke-dashoffset:0] starting:[stroke-dashoffset:14] transition-[stroke-dashoffset] duration-[160ms] ease-out motion-reduce:transition-none"
      />
    </svg>
  );
}

function SaveStatus({ state, labels, action, className }: SaveStatusProps) {
  return (
    <div
      data-slot="save-status"
      role="status"
      aria-live="polite"
      className={cn('flex items-center gap-2 text-small text-fg-muted', className)}
    >
      {state === 'idle' ? null : (
        <span key={state} className="inline-flex items-center gap-2 animate-[fade-in-only_150ms_var(--ease-out)]">
          {state === 'saved' ? <SavedCheck /> : null}
          {state === 'error' || state === 'tooLarge' ? (
            <WarningIcon aria-hidden="true" size={14} className="text-danger" />
          ) : null}
          {state === 'offline' || state === 'conflict' || state === 'invalid' || state === 'signedOut' ? (
            <WarningIcon aria-hidden="true" size={14} className="text-attention" />
          ) : null}
          <span>{labels[state]}</span>
          {action === undefined ? null : action}
        </span>
      )}
    </div>
  );
}

export { SaveStatus };
