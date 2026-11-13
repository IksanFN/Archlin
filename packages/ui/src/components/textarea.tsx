import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';
import { fieldSurface } from './input';

function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldSurface,
        'min-h-[88px] px-[14px] py-3 text-small leading-[1.5] [field-sizing:content]',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
