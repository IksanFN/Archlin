import { CheckIcon, InfoIcon, WarningIcon, CircleNotchIcon } from '@phosphor-icons/react/ssr';
import { Toaster as Sonner } from 'sonner';
import type { CSSProperties } from 'react';
import { useSyncExternalStore } from 'react';
import type { ToasterProps } from 'sonner';
import { useTheme } from '../lib/theme';

const NARROW_TOAST = '(max-width: 767px)';

function subscribeToastQuery(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW_TOAST);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readToastPosition(): NonNullable<ToasterProps['position']> {
  return window.matchMedia(NARROW_TOAST).matches ? 'top-center' : 'bottom-right';
}

// Sonner keeps its own width and radius in CSS variables, so the grok tokens are fed in through those.
function Toaster({ toastOptions, position, ...props }: ToasterProps) {
  const { resolved } = useTheme();
  const responsivePosition = useSyncExternalStore(subscribeToastQuery, readToastPosition, () => 'bottom-right' as const);
  return (
    <Sonner
      theme={resolved}
      position={position ?? responsivePosition}
      icons={{
        success: <CheckIcon size={18} className="text-success" />,
        info: <InfoIcon size={18} className="text-info" />,
        warning: <WarningIcon size={18} className="text-attention" />,
        error: <WarningIcon size={18} className="text-danger" />,
        loading: <CircleNotchIcon size={18} className="animate-spin" />,
      }}
      toastOptions={{ duration: 5000, classNames: { toast: 'text-small shadow-overlay!' }, ...toastOptions }}
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
