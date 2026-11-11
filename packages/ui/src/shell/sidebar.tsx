import { SidebarSimpleIcon } from '@phosphor-icons/react/ssr';
import { createContext, use } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../components/button';
import { cn } from '../lib/utils';

// The same sidebar tree renders in the desktop column and in the mobile drawer; the drawer has no collapse control.
export const ShellContext = createContext<{ inDrawer: boolean; hideSidebar: (() => void) | null }>({
  inDrawer: false,
  hideSidebar: null,
});

function Logo({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-3', className)}>
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-sm bg-inverse text-[14px] font-semibold text-inverse-fg"
      >
        {name.charAt(0)}
      </span>
      <span className="text-ui font-semibold text-fg">{name}</span>
    </span>
  );
}

function SidebarHeader({ name, hideLabel }: { name: string; hideLabel: string }) {
  const { inDrawer, hideSidebar } = use(ShellContext);
  return (
    <div className="mb-5 flex h-12 items-center justify-between pr-2 pl-2.5">
      <Logo name={name} />
      {inDrawer || hideSidebar === null ? null : (
        <Button variant="icon" size="icon-sm" aria-label={hideLabel} className="bg-transparent text-fg-muted hover:bg-overlay" onClick={hideSidebar}>
          <SidebarSimpleIcon aria-hidden="true" size={18} />
        </Button>
      )}
    </div>
  );
}

function Sidebar({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col gap-1 p-5">{children}</div>;
}

export { Logo, Sidebar, SidebarHeader };
