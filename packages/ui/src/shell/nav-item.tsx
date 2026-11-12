import { Link } from '@tanstack/react-router';
import type { Icon } from '@phosphor-icons/react';
import { use } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip';
import { cn } from '../lib/utils';
import { ShellContext } from './sidebar';

interface NavItemProps {
  to: string;
  icon: Icon;
  label: string;
  meta?: string;
  selected: boolean;
}

// Rows stay 44px tall (MOCKUPS rule 4) so they are comfortable touch targets in the mobile drawer too.
function NavItem({ to, icon: NavIcon, label, meta, selected }: NavItemProps) {
  const { variant } = use(ShellContext);
  const rail = variant === 'rail';

  const link = (
    <Link
      to={to}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex h-11 items-center rounded-md text-ui transition-colors duration-[120ms] ease-out hover:bg-overlay',
        rail ? 'w-full justify-center' : 'gap-3 pr-3 pl-[14px]',
        selected ? 'bg-selected font-medium text-fg' : 'text-fg-secondary',
      )}
    >
      <NavIcon aria-hidden="true" size={18} className={selected ? 'text-fg' : 'text-fg-muted'} />
      <span className={rail ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{label}</span>
      {meta === undefined || rail ? null : <span className="font-mono text-micro text-fg-muted">{meta}</span>}
    </Link>
  );

  if (!rail) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export { NavItem };
