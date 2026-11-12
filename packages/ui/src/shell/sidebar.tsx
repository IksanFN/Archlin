import { SidebarSimpleIcon } from '@phosphor-icons/react/ssr';
import { createContext, use } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip';
import { cn } from '../lib/utils';

export type SidebarVariant = 'full' | 'rail' | 'drawer';

interface ShellState {
  variant: SidebarVariant;
  // Null where the control does not exist: the drawer has no collapse, the full sidebar has no expand.
  collapse: (() => void) | null;
  expand: (() => void) | null;
}

// One sidebar tree renders as the full column, the icon rail and the mobile drawer; each part reads the variant.
export const ShellContext = createContext<ShellState>({ variant: 'full', collapse: null, expand: null });

function LogoMark({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-inverse text-[14px] font-semibold text-inverse-fg"
    >
      {name.charAt(0)}
    </span>
  );
}

function Logo({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-3', className)}>
      <LogoMark name={name} />
      <span className="text-ui font-semibold text-fg">{name}</span>
    </span>
  );
}

const headerButton = 'bg-transparent text-fg-muted hover:bg-overlay';

function SidebarHeader({ name, hideLabel, showLabel }: { name: string; hideLabel: string; showLabel: string }) {
  const { variant, collapse, expand } = use(ShellContext);

  if (variant === 'rail') {
    return (
      <div className="mb-3 flex flex-col items-center gap-2 pt-2">
        <LogoMark name={name} />
        {expand === null ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="icon" size="icon-sm" aria-label={showLabel} className={headerButton} onClick={expand}>
                <SidebarSimpleIcon aria-hidden="true" size={18} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{showLabel}</TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  return (
    <div className="mb-5 flex h-12 items-center justify-between pr-2 pl-2.5">
      <Logo name={name} />
      {variant === 'drawer' || collapse === null ? null : (
        <Button variant="icon" size="icon-sm" aria-label={hideLabel} className={headerButton} onClick={collapse}>
          <SidebarSimpleIcon aria-hidden="true" size={18} />
        </Button>
      )}
    </div>
  );
}

function Sidebar({ children }: { children: ReactNode }) {
  const { variant } = use(ShellContext);
  return <div className={cn('flex h-full flex-col gap-1', variant === 'rail' ? 'p-3' : 'p-5')}>{children}</div>;
}

export { Logo, Sidebar, SidebarHeader };
