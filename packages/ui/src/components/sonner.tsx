import { CheckIcon, InfoIcon, WarningIcon, CircleNotchIcon } from '@phosphor-icons/react/ssr';
import { Toaster as Sonner } from 'sonner';
import type { CSSProperties } from 'react';
import type { ToasterProps } from 'sonner';
import { useTheme } from '../lib/theme';

// Sonner keeps its own width and radius in CSS variables, so the grok tokens are fed in through those.
function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      icons={{
        success: <CheckIcon size={18} className="text-success" />,
        info: <InfoIcon size={18} className="text-info" />,
        warning: <WarningIcon size={18} className="text-attention" />,
        error: <WarningIcon size={18} className="text-danger" />,
        loading: <CircleNotchIcon size={18} className="animate-spin" />,
      }}
      toastOptions={{ classNames: { toast: 'text-small shadow-overlay!' } }}
      style={
        {
          '--width': 'min(420px, calc(100vw - 32px))',
          '--border-radius': 'var(--grok-radius-lg)',
          '--normal-bg': 'var(--grok-color-surface-raised)',
          '--normal-text': 'var(--grok-color-text)',
          '--normal-border': 'var(--grok-color-border-subtle)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { toast } from 'sonner';
export { Toaster };
