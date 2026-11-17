import { Button } from '@archlin/ui/components/button';
import { Sheet, SheetContent, SheetTitle } from '@archlin/ui/components/sheet';
import { XIcon } from '@phosphor-icons/react/ssr';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

export type PanelLayout = 'docked' | 'sheet';

const EXIT_MS = 240;

// Keeps the docked column mounted for its exit transition and hands focus back to whatever opened it.
function useDockPresence(open: boolean): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open) return undefined;
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  return { mounted: open || mounted, leaving: !open && mounted };
}

export function PanelFrame({
  layout,
  open,
  onOpenChange,
  title,
  returnFocus,
  children,
}: {
  layout: PanelLayout;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  // The control that opened the panel; the page menu closes before the panel does, so focus cannot be read back from the document.
  returnFocus?: RefObject<HTMLElement | null> | undefined;
  children: ReactNode;
}) {
  const { mounted, leaving } = useDockPresence(layout === 'docked' && open);
  const asideRef = useRef<HTMLElement>(null);

  const close = useRef(onOpenChange);
  useEffect(() => {
    close.current = onOpenChange;
  });

  useEffect(() => {
    if (layout !== 'docked' || !open) return undefined;
    asideRef.current?.focus();
    // Focus can sit on the menu trigger that opened the panel, so Escape is read from the document; menus and dialogs claim it first.
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) close.current(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const target = returnFocus;
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      target?.current?.focus();
    };
  }, [layout, open, returnFocus]);

  if (layout === 'sheet') {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (returnFocus?.current == null) return;
            event.preventDefault();
            returnFocus.current.focus();
          }}
        >
          <SheetTitle>{title}</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
    );
  }
  if (!mounted) return null;
  return (
    <aside
      ref={asideRef}
      aria-label={title}
      tabIndex={-1}
      data-leaving={leaving ? 'true' : undefined}
      className="kb-dock sticky top-0 flex h-[calc(100dvh-3.5rem)] w-[400px] shrink-0 flex-col self-start border-l border-line-subtle bg-surface outline-none"
    >
      {children}
    </aside>
  );
}

export function PanelHeader({
  title,
  action,
  closeLabel,
  onClose,
}: {
  title: string;
  action: ReactNode;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
      <h2 className="min-w-0 flex-1 truncate text-ui font-medium text-fg">{title}</h2>
      {action}
      <Button variant="icon" size="icon-sm" aria-label={closeLabel} className="bg-transparent hover:bg-overlay" onClick={onClose}>
        <XIcon aria-hidden="true" size={16} />
      </Button>
    </div>
  );
}
