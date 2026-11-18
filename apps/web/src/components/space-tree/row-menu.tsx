import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@archlin/ui/components/dropdown-menu';
import { DotsThreeIcon } from '@phosphor-icons/react/ssr';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@archlin/ui/lib/utils';

// Radix triggers hand their handlers and ref to this button through `asChild`; dropping them leaves the menu unopenable by pointer.
export function RowIconButton({ label, children, onClick, ...rest }: { label: string } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-sm text-fg-muted fine-hover:bg-overlay [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:shrink-0"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.(event);
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
