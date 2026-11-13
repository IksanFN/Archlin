export const TREE_EXPANDED_KEY = 'archlin.tree.expanded';

const listeners = new Set<() => void>();
const EMPTY = new Set<string>();
// Fallback for a tab whose storage refuses writes, so expand/collapse still responds.
let cached: Set<string> = EMPTY;
let hydrated = false;

function loadFromStorage(): Set<string> {
  try {
    const raw = window.localStorage.getItem(TREE_EXPANDED_KEY);
    if (raw === null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return EMPTY;
  }
}

export function readExpanded(): Set<string> {
  if (typeof window === 'undefined') return EMPTY;
  if (!hydrated) {
    cached = loadFromStorage();
    hydrated = true;
  }
  return cached;
}

export function writeExpanded(ids: ReadonlySet<string>): void {
  cached = new Set(ids);
  hydrated = true;
  try {
    window.localStorage.setItem(TREE_EXPANDED_KEY, JSON.stringify([...cached]));
  } catch {
    // Keep the in-memory set so this tab still expands.
  }
  for (const listener of listeners) listener();
}

export function subscribeExpanded(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== TREE_EXPANDED_KEY) return;
    cached = loadFromStorage();
    hydrated = true;
    onChange();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}
