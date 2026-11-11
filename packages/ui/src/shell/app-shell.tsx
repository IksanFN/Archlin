import { ListIcon, SidebarSimpleIcon } from '@phosphor-icons/react/ssr';
import { useState, useSyncExternalStore } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Button } from '../components/button';
import { Sheet, SheetContent, SheetTitle } from '../components/sheet';
import { cn } from '../lib/utils';
import { SkipLink } from './skip-link';
import { ShellContext } from './sidebar';

export const SIDEBAR_HIDDEN_KEY = 'archlin.sidebar.hidden';

export const MAIN_ID = 'konten';

export interface AppShellLabels {
  skipToContent: string;
  navigation: string;
  openNavigation: string;
  showSidebar: string;
}

interface AppShellProps {
  sidebar: ReactNode;
  title: string;
  labels: AppShellLabels;
  children: ReactNode;
}

const hiddenListeners = new Set<() => void>();
// Fallback for a tab whose storage refuses writes, so the toggle still responds.
let unsavedHidden: boolean | null = null;

function readHidden(): boolean {
  if (unsavedHidden !== null) return unsavedHidden;
  try {
    return window.localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(SIDEBAR_HIDDEN_KEY, '1');
    else window.localStorage.removeItem(SIDEBAR_HIDDEN_KEY);
    unsavedHidden = null;
  } catch {
    unsavedHidden = hidden;
  }
  for (const listener of hiddenListeners) listener();
}

function subscribeHidden(onChange: () => void): () => void {
  hiddenListeners.add(onChange);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === SIDEBAR_HIDDEN_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    hiddenListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function AppShell({ sidebar, title, labels, children }: AppShellProps) {
  const hidden = useSyncExternalStore(subscribeHidden, readHidden, () => false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A tapped link inside the drawer navigates; the drawer should not stay open over the new page.
  const closeDrawerOnNavigate = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element && event.target.closest('a[href]') !== null) setDrawerOpen(false);
  };

  return (
    <div className={cn('min-h-dvh nav:grid', hidden ? 'nav:grid-cols-[1fr]' : 'nav:grid-cols-[300px_1fr]')}>
      <SkipLink label={labels.skipToContent} targetId={MAIN_ID} />

      <aside
        aria-label={labels.navigation}
        className={cn('sticky top-0 hidden h-dvh overflow-y-auto bg-surface', hidden ? '' : 'nav:block')}
      >
        <ShellContext value={{ inDrawer: false, hideSidebar: () => writeHidden(true) }}>{sidebar}</ShellContext>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line-subtle px-4 nav:hidden">
          <Button variant="icon" size="icon-sm" aria-label={labels.openNavigation} className="bg-transparent hover:bg-overlay" onClick={() => setDrawerOpen(true)}>
            <ListIcon aria-hidden="true" size={20} />
          </Button>
          <span className="truncate text-ui font-medium text-fg">{title}</span>
        </header>

        {hidden ? (
          <div className="hidden px-4 pt-4 nav:block">
            <Button variant="icon" size="icon-sm" aria-label={labels.showSidebar} className="bg-transparent text-fg-muted hover:bg-overlay" onClick={() => writeHidden(false)}>
              <SidebarSimpleIcon aria-hidden="true" size={18} />
            </Button>
          </div>
        ) : null}

        <main id={MAIN_ID} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          {children}
        </main>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent aria-describedby={undefined} onClick={closeDrawerOnNavigate}>
          <SheetTitle>{labels.navigation}</SheetTitle>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ShellContext value={{ inDrawer: true, hideSidebar: null }}>{sidebar}</ShellContext>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export { AppShell };
