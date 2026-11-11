import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/utils';

export const fieldSurface =
  'w-full rounded-md bg-overlay border border-line-subtle text-fg has-[[aria-invalid=true]]:border-danger has-[:disabled]:bg-disabled-bg has-[:disabled]:text-fg-disabled';

const fieldSize = {
  default: 'h-10 pl-[14px] pr-3 text-small',
  lg: 'h-11 px-[14px] text-ui',
} as const;

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  size?: keyof typeof fieldSize;
  leadingIcon?: ReactNode;
  trailing?: ReactNode;
  // className styles the field frame; inputClassName styles the bare element inside it.
  inputClassName?: string;
}

// The frame owns border, fill and focus ring so an icon or a button can sit inside the same field.
function Input({ className, inputClassName, size = 'default', leadingIcon, trailing, ...props }: InputProps) {
  return (
    <div
      data-slot="input"
      className={cn(
        'flex items-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus',
        fieldSurface,
        fieldSize[size],
        className,
      )}
    >
      {leadingIcon === undefined ? null : (
        <span className="mr-2.5 flex shrink-0 text-fg-muted [&_svg]:size-4">{leadingIcon}</span>
      )}
      <input
        className={cn(
          'min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-muted disabled:cursor-not-allowed disabled:text-fg-disabled',
          inputClassName,
        )}
        {...props}
      />
      {trailing}
    </div>
  );
}

export { Input };
