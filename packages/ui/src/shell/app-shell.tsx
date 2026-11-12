import { ListIcon } from '@phosphor-icons/react/ssr';
import { useState, useSyncExternalStore } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Button } from '../components/button';
import { Sheet, SheetContent, SheetTitle } from '../components/sheet';
import { cn } from '../lib/utils';
import { SkipLink } from './skip-link';
import { ShellContext } from './sidebar';

export const SIDEBAR_COLLAPSED_KEY = 'archlin.sidebar.collapsed';

export const MAIN_ID = 'konten';

export interface AppShellLabels {
  skipToContent: string;
  navigation: string;
  openNavigation: string;
}

interface AppShellProps {
  sidebar: ReactNode;
  title: string;
  labels: AppShellLabels;
  children: ReactNode;
}

const collapsedListeners = new Set<() => void>();
// Fallback for a tab whose storage refuses writes, so the toggle still responds.
let unsavedCollapsed: boolean | null = null;

function readCollapsed(): boolean {
  if (unsavedCollapsed !== null) return unsavedCollapsed;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    else window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    unsavedCollapsed = null;
  } catch {
    unsavedCollapsed = collapsed;
  }
  for (const listener of collapsedListeners) listener();
}

function subscribeCollapsed(onChange: () => void): () => void {
  collapsedListeners.add(onChange);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === SIDEBAR_COLLAPSED_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    collapsedListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function AppShell({ sidebar, title, labels, children }: AppShellProps) {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A tapped link inside the drawer navigates; the drawer should not stay open over the new page.
  const closeDrawerOnNavigate = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element && event.target.closest('a[href]') !== null) setDrawerOpen(false);
  };

  return (
    <div className={cn('min-h-dvh nav:grid', collapsed ? 'nav:grid-cols-[72px_1fr]' : 'nav:grid-cols-[300px_1fr]')}>
      <SkipLink label={labels.skipToContent} targetId={MAIN_ID} />

      <aside aria-label={labels.navigation} className="sticky top-0 hidden h-dvh overflow-x-hidden overflow-y-auto bg-surface nav:block">
        <ShellContext
          value={{
            variant: collapsed ? 'rail' : 'full',
            collapse: collapsed ? null : () => writeCollapsed(true),
            expand: collapsed ? () => writeCollapsed(false) : null,
          }}
        >
          {sidebar}
        </ShellContext>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line-subtle px-4 nav:hidden">
          <Button variant="icon" size="icon-sm" aria-label={labels.openNavigation} className="bg-transparent hover:bg-overlay" onClick={() => setDrawerOpen(true)}>
            <ListIcon aria-hidden="true" size={20} />
          </Button>
          <span className="truncate text-ui font-medium text-fg">{title}</span>
        </header>

        <main id={MAIN_ID} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          {children}
        </main>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent aria-describedby={undefined} onClick={closeDrawerOnNavigate}>
          <SheetTitle>{labels.navigation}</SheetTitle>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ShellContext value={{ variant: 'drawer', collapse: null, expand: null }}>{sidebar}</ShellContext>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export { AppShell };
