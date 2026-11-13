import { CheckIcon, CopyIcon } from '@phosphor-icons/react/ssr';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { toast } from './sonner';

interface CopyButtonProps {
  value: string;
  labels: { copy: string; copied: string; failed: string };
  variant?: 'ghost' | 'outline';
  size?: 'row' | 'icon-sm';
  className?: string;
}

function CopyButton({ value, labels, variant = 'ghost', size = 'row', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(labels.failed);
    }
  }

  const label = copied ? labels.copied : labels.copy;
  const iconOnly = size === 'icon-sm';

  return (
    <Button variant={variant} size={size} aria-label={label} className={className} data-slot="copy-button" onClick={() => void copy()}>
      <span className="relative grid items-center justify-items-center">
        <span
          className={cn(
            'col-start-1 row-start-1 inline-flex items-center gap-2 transition-[opacity,transform] duration-[150ms] ease-out',
            copied ? 'scale-90 opacity-0' : 'scale-100 opacity-100',
          )}
          aria-hidden={copied}
        >
          <CopyIcon aria-hidden="true" size={16} />
          {iconOnly ? null : labels.copy}
        </span>
        <span
          className={cn(
            'col-start-1 row-start-1 inline-flex items-center gap-2 transition-[opacity,transform] duration-[150ms] ease-out',
            copied ? 'scale-100 opacity-100' : 'scale-90 opacity-0',
          )}
          aria-hidden={!copied}
        >
          <CheckIcon aria-hidden="true" size={16} />
          {iconOnly ? null : labels.copied}
        </span>
        <span className="sr-only" aria-live="polite">
          {label}
        </span>
      </span>
    </Button>
  );
}

export { CopyButton };
