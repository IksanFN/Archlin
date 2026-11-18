import { CaretRightIcon } from '@phosphor-icons/react/ssr';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';

function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ className, ...props }: ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" className={cn('group', className)} {...props} />;
}

function CollapsibleContent({ className, ...props }: ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      className={cn(
        'overflow-hidden motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:duration-150 data-[state=closed]:ease-in',
        className,
      )}
      {...props}
    />
  );
}

function CollapsibleChevron({ className, ...props }: ComponentProps<typeof CaretRightIcon>) {
  return (
    <CaretRightIcon
      {...props}
      aria-hidden="true"
      size={14}
      data-slot="collapsible-chevron"
      className={cn(
        'transition-transform duration-200 ease-out group-data-[state=open]:rotate-90 motion-reduce:transition-none',
        className,
      )}
    />
  );
}

export { Collapsible, CollapsibleChevron, CollapsibleContent, CollapsibleTrigger };
