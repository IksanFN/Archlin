import { Link } from '@tanstack/react-router';
import type { Icon } from '@phosphor-icons/react';
import { cn } from '../lib/utils';

interface NavItemProps {
  to: string;
  icon: Icon;
  label: string;
  meta?: string;
  selected: boolean;
}

// Rows stay 44px tall (MOCKUPS rule 4) so they are comfortable touch targets in the mobile drawer too.
function NavItem({ to, icon: NavIcon, label, meta, selected }: NavItemProps) {
  return (
    <Link
      to={to}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex h-11 items-center gap-3 rounded-md pr-3 pl-[14px] text-ui transition-colors duration-[120ms] ease-out hover:bg-overlay',
        selected ? 'bg-selected font-medium text-fg' : 'text-fg-secondary',
      )}
    >
      <NavIcon aria-hidden="true" size={18} className={selected ? 'text-fg' : 'text-fg-muted'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta === undefined ? null : <span className="font-mono text-micro text-fg-muted">{meta}</span>}
    </Link>
  );
}

export { NavItem };
