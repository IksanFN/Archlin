import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@archlin/ui/components/dropdown-menu';
import { DotsThreeIcon } from '@phosphor-icons/react/ssr';
import type { ReactNode } from 'react';
import { cn } from '@archlin/ui/lib/utils';

export function RowIconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-sm text-fg-muted fine-hover:bg-overlay"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

export function RowMenu({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <RowIconButton label={label}>
          <DotsThreeIcon aria-hidden="true" size={16} />
        </RowIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" onCloseAutoFocus={(event) => event.preventDefault()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RowMenuItem({
  children,
  onSelect,
  disabled,
  danger,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className={cn(danger && 'text-danger data-[highlighted]:text-danger')}
    >
      {children}
    </DropdownMenuItem>
  );
}

export { DropdownMenuSeparator as RowMenuSeparator };
