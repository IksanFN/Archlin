import { Tabs as TabsPrimitive } from 'radix-ui';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { tabIndicatorTransform } from '../lib/motion';
import { cn } from '../lib/utils';

function Tabs(props: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />;
}

function TabsList({ className, children, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState('translateX(0px) scaleX(0)');

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const update = (): void => {
      const active = list.querySelector('[role="tab"][data-state="active"]');
      if (!(active instanceof HTMLElement)) return;
      setTransform(tabIndicatorTransform(list.getBoundingClientRect(), active.getBoundingClientRect()));
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(list);
    const mutation = new MutationObserver(update);
    mutation.observe(list, { attributes: true, subtree: true, attributeFilter: ['data-state'] });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [children]);

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      className={cn('relative flex border-b border-line', className)}
      {...props}
    >
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-px origin-left bg-fg transition-transform duration-200 ease-inout motion-reduce:transition-none"
        style={{ transform }}
      />
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'h-10 px-3 text-small text-fg-muted transition-[color,transform] duration-[120ms] ease-out data-[state=active]:text-fg enabled:active:scale-[0.98] motion-reduce:enabled:active:scale-100',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('animate-[fade-in-only_150ms_var(--ease-out)]', className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
