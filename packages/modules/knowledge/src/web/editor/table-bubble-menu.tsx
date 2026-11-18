import { Button } from '@archlin/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@archlin/ui/components/tooltip';
import { RowsPlusBottomIcon, ColumnsPlusRightIcon, RowsIcon, ColumnsIcon, TableIcon, TrashIcon } from '@phosphor-icons/react/ssr';
import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { useEditorState } from '@tiptap/react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { playBubbleFadeIn, shouldShowTableBubble } from './bubble-visibility';
import type { EditorLabels } from './labels';

function keepSelection(event: MouseEvent): void {
  event.preventDefault();
}

export function TableBubbleMenu({ editor, labels }: { editor: Editor; labels: EditorLabels }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const focusedAction = useRef<number | null>(null);
  const movingToolbar = useRef(false);
  const dockedRef = useRef(false);
  const [dockTarget, setDockTarget] = useState<HTMLElement | null>(null);
  const [docked, setDocked] = useState(false);
  const previousCellY = useRef<number | null>(null);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const inHeader = useEditorState({
    editor,
    selector: ({ editor: instance }) => instance.isActive('tableHeader'),
  });

  useLayoutEffect(() => {
    let wrapper: HTMLElement | null = null;
    let previousStart = '';
    let previousEnd = '';
    let focusFrame = 0;
    let side: 'top' | 'bottom' | null = null;
    const restore = () => {
      if (wrapper !== null) {
        wrapper.style.paddingBlockStart = previousStart;
        wrapper.style.paddingBlockEnd = previousEnd;
      }
      wrapper = null;
    };
    const update = () => {
      const buttons = Array.from(toolbarRef.current?.querySelectorAll('button') ?? []);
      const focused = buttons.findIndex((button) => button === document.activeElement);
      if (focused >= 0) focusedAction.current = focused;
      else if (!movingToolbar.current) focusedAction.current = null;
      setDockTarget(editor.view.dom.closest('main')?.querySelector<HTMLElement>('[data-slot="shell-dock"]') ?? null);
      const dom = editor.view.domAtPos(editor.state.selection.from).node;
      const table = (dom instanceof Element ? dom : dom.parentElement)?.closest('table');
      const active = document.activeElement;
      const hasFocus = editor.view.dom.contains(active) || toolbarRef.current?.contains(active) === true ||
        (active === document.body && movingToolbar.current);
      const next = hasFocus && shouldShowTableBubble(editor, editor.state.selection) ? table?.parentElement ?? null : null;
      if (next === null) {
        dockedRef.current = false;
        setDocked(false);
        restore();
        side = null;
        return;
      }
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      if (table !== null && table !== undefined && table.getBoundingClientRect().height > viewportHeight - 128) {
        previousCellY.current = editor.view.coordsAtPos(editor.state.selection.from).top;
        restore();
        side = null;
        if (!dockedRef.current && focused >= 0) movingToolbar.current = true;
        dockedRef.current = true;
        setDocked(true);
        return;
      }
      if (dockedRef.current && focused >= 0) movingToolbar.current = true;
      dockedRef.current = false;
      setDocked(false);
      const nextSide = next.getBoundingClientRect().top >= (viewport?.offsetTop ?? 0) + 64 ? 'top' : 'bottom';
      if (next === wrapper && nextSide === side) return;
      restore();
      wrapper = next;
      if (wrapper !== null) {
        previousStart = wrapper.style.paddingBlockStart;
        previousEnd = wrapper.style.paddingBlockEnd;
        // Use the wrapper edge, which stays stable when its padding changes.
        wrapper.style.paddingBlockStart = nextSide === 'top' ? '64px' : previousStart;
        wrapper.style.paddingBlockEnd = nextSide === 'bottom' ? '64px' : previousEnd;
        side = nextSide;
        setPlacement(nextSide);
      }
      editor.commands.setMeta('kb-table-bubble', 'updatePosition');
    };
    const updateFocus = () => {
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(update);
    };
    update();
    editor.on('selectionUpdate', update);
    editor.on('update', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', updateFocus);
    document.addEventListener('focusout', updateFocus);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', updateFocus);
      document.removeEventListener('focusout', updateFocus);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.cancelAnimationFrame(focusFrame);
      restore();
    };
  }, [editor]);

  useLayoutEffect(() => {
    if (!docked || dockTarget === null) return;
    const content = dockTarget.previousElementSibling;
    if (!(content instanceof HTMLElement)) return;
    const shell = dockTarget.closest<HTMLElement>('.app-shell');
    const viewport = window.visualViewport;
    const updateViewport = () => {
      if (shell === null) return;
      shell.style.setProperty('--shell-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      shell.style.setProperty('--shell-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    };
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    const bounds = content.getBoundingClientRect();
    const caret = editor.view.coordsAtPos(editor.state.selection.from);
    const targetY = Math.max(bounds.top + 8, Math.min(previousCellY.current ?? caret.top, bounds.bottom - 32));
    content.scrollBy(0, caret.top - targetY);
    return () => {
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      shell?.style.removeProperty('--shell-viewport-height');
      shell?.style.removeProperty('--shell-viewport-top');
      if (editor.isDestroyed) return;
      const selectionY = editor.view.coordsAtPos(editor.state.selection.from).top;
      window.requestAnimationFrame(() => {
        if (editor.isDestroyed || dockTarget.childElementCount !== 0) return;
        const currentY = editor.view.coordsAtPos(editor.state.selection.from).top;
        window.scrollBy(0, currentY - selectionY);
      });
    };
  }, [docked, dockTarget, editor]);

  useLayoutEffect(() => {
    const index = focusedAction.current;
    if (index === null) return;
    // BubbleMenu attaches its portal in an effect, after this layout pass.
    const frame = window.requestAnimationFrame(() => {
      toolbarRef.current?.querySelectorAll('button')[index]?.focus({ preventScroll: true });
      movingToolbar.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [docked]);

  const toolbar = (
    <div
      ref={toolbarRef}
      className="flex items-center gap-0.5"
      role="toolbar"
      aria-label={labels.slash.table}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          editor.chain().focus().run();
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
        const index = buttons.findIndex((button) => button === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
          (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault();
        buttons[next]?.focus();
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            aria-label={labels.table.addRowBelow}
            className="size-11 px-0"
            onMouseDown={keepSelection}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            <RowsPlusBottomIcon aria-hidden="true" size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{labels.table.addRowBelow}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            aria-label={labels.table.addColumnRight}
            className="size-11 px-0"
            onMouseDown={keepSelection}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            <ColumnsPlusRightIcon aria-hidden="true" size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{labels.table.addColumnRight}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            aria-label={labels.table.deleteRow}
            className="size-11 px-0"
            onMouseDown={keepSelection}
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            <RowsIcon aria-hidden="true" size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{labels.table.deleteRow}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            aria-label={labels.table.deleteColumn}
            className="size-11 px-0"
            onMouseDown={keepSelection}
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            <ColumnsIcon aria-hidden="true" size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{labels.table.deleteColumn}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            aria-label={labels.table.headerRow}
            aria-pressed={inHeader}
            className={inHeader ? 'size-11 px-0 bg-overlay text-fg' : 'size-11 px-0'}
            onMouseDown={keepSelection}
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
          >
            <TableIcon aria-hidden="true" size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{labels.table.headerRow}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            aria-label={labels.table.deleteTable}
            className="size-11 px-0 text-danger"
            onMouseDown={keepSelection}
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            <TrashIcon aria-hidden="true" size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{labels.table.deleteTable}</TooltipContent>
      </Tooltip>
    </div>
);

  if (docked) {
    const dock = <div className="flex min-h-16 justify-center border-t border-line-subtle bg-surface-raised px-2 py-2" data-table-dock>{toolbar}</div>;
    return dockTarget === null ? dock : createPortal(dock, dockTarget);
  }

  return (
    <BubbleMenu
      ref={menuRef}
      editor={editor}
      pluginKey="kb-table-bubble"
      getReferencedVirtualElement={() => {
        const dom = editor.view.domAtPos(editor.state.selection.from).node;
        const table = (dom instanceof Element ? dom : dom.parentElement)?.closest('table');
        return table ? { getBoundingClientRect: () => table.getBoundingClientRect(), contextElement: table } : null;
      }}
      options={{
        placement,
        offset: 8,
        flip: false,
        shift: { padding: 8 },
        onShow: () => {
          if (menuRef.current !== null) playBubbleFadeIn(menuRef.current);
        },
      }}
      shouldShow={({ editor: instance, state }) => shouldShowTableBubble(instance, state.selection)}
      className="kb-bubble-menu flex max-w-[calc(100vw-1rem)] items-center gap-0.5 rounded-lg border border-line-subtle bg-surface-raised p-1 shadow-overlay"
    >
      {toolbar}
    </BubbleMenu>
  );
}
