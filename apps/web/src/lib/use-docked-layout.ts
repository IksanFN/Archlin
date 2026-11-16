import { useSyncExternalStore } from 'react';
import type { PanelLayout } from '@archlin/modules-knowledge/web';

// Same width as the `lg` breakpoint: the page keeps a 400px column beside the reading column from there up.
const DOCKED_QUERY = '(min-width: 1280px)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DOCKED_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function usePanelLayout(): PanelLayout {
  return useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(DOCKED_QUERY).matches ? 'docked' : 'sheet'),
    () => 'docked',
  );
}
