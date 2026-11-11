import { CaretUpDownIcon } from '@phosphor-icons/react/ssr';
import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';
import { fieldSurface } from './input';

const selectSize = {
  default: 'h-10 pl-[14px] pr-9 text-small',
  lg: 'h-11 pl-[14px] pr-10 text-ui',
} as const;

export interface NativeSelectProps extends Omit<ComponentProps<'select'>, 'size'> {
  size?: keyof typeof selectSize;
  wrapperClassName?: string;
}

// A real <select>: the platform picker is keyboard and screen reader complete, so only the frame is styled.
function NativeSelect({ className, wrapperClassName, size = 'default', children, ...props }: NativeSelectProps) {
  return (
    <div
      data-slot="native-select"
      className={cn(
        'relative flex items-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus',
        fieldSurface,
        wrapperClassName,
      )}
    >
      <select
        className={cn('w-full appearance-none rounded-md bg-transparent outline-none disabled:cursor-not-allowed', selectSize[size], className)}
        {...props}
      >
        {children}
      </select>
      <CaretUpDownIcon aria-hidden="true" size={16} className="pointer-events-none absolute right-3 text-fg-muted" />
    </div>
  );
}

export { NativeSelect };
