import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'archlin.theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readThemePreference(storage: Pick<Storage, 'getItem'> | null): ThemePreference {
  if (storage === null) return 'system';
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // Blocked storage (private window, site data off) just means no saved choice.
    return 'system';
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

// Runs inline in <head> before first paint so the page never flashes the wrong theme.
export const themeBootScript = `(function(){var t='dark';try{var p=null;try{p=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}t=p==='light'||p==='dark'?p:(window.matchMedia('${DARK_QUERY}').matches?'dark':'light')}catch(e){}document.documentElement.dataset.theme=t})();`;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Holds the choice for this tab when storage refuses the write, so the toggle still works.
let unsavedPreference: ThemePreference | null = null;
const listeners = new Set<() => void>();

function currentPreference(): ThemePreference {
  return unsavedPreference ?? readThemePreference(browserStorage());
}

function applyToDocument(): void {
  const prefersDark = window.matchMedia(DARK_QUERY).matches;
  document.documentElement.dataset.theme = resolveTheme(currentPreference(), prefersDark);
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribePreference(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === THEME_STORAGE_KEY) {
      applyToDocument();
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function subscribeSystem(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  const onSystemChange = (): void => {
    if (currentPreference() === 'system') applyToDocument();
    onChange();
  };
  query.addEventListener('change', onSystemChange);
  return () => query.removeEventListener('change', onSystemChange);
}

function setPreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    unsavedPreference = null;
  } catch {
    unsavedPreference = preference;
  }
  applyToDocument();
  notify();
}

export function useTheme(): { preference: ThemePreference; resolved: ResolvedTheme; setPreference(p: ThemePreference): void } {
  const preference = useSyncExternalStore(subscribePreference, currentPreference, () => 'system' as const);
  const prefersDark = useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  return { preference, resolved: resolveTheme(preference, prefersDark), setPreference };
}
