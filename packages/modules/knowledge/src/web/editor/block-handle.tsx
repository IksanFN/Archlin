import { Button } from '@archlin/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@archlin/ui/components/dropdown-menu';
import { Kbd } from '@archlin/ui/components/kbd';
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { DotsSixVerticalIcon } from '@phosphor-icons/react/ssr';
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { useEditorState } from '@tiptap/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { currentBlockPos, deleteBlock, duplicateBlock, moveBlock } from './block-commands';
import type { EditorLabels } from './labels';

export const blockHandleKey = new PluginKey<{ blockPos: number | null }>('blockHandle');

function blockElement(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos);
  if (dom instanceof HTMLElement) return dom;
  if (dom instanceof Text) return dom.parentElement;
  return null;
}

const DRAG_THRESHOLD_PX = 4;

function movedPastThreshold(fromX: number, fromY: number, toX: number, toY: number): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  return dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
}

function beginBlockDrag(view: EditorView, blockPos: number, dataTransfer: DataTransfer): void {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, blockPos)));
  view.dragging = { slice: view.state.selection.content(), move: true };
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData('text/plain', '');
}

function hoveredBlockPos(view: EditorView, event: MouseEvent): number | null {
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (coords === null) return null;
  const $pos = view.state.doc.resolve(coords.pos);
  if ($pos.depth >= 1) return $pos.before(1);
  if (view.state.doc.nodeAt($pos.pos) !== null) return $pos.pos;
  return currentBlockPos(view.state);
}

export const BlockHandleExtension = Extension.create({
  name: 'blockHandle',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockHandleKey,
        state: {
          init: () => ({ blockPos: null as number | null }),
          apply(tr, value) {
            const meta = tr.getMeta(blockHandleKey) as { blockPos: number | null } | undefined;
            if (meta !== undefined) return meta;
            if (tr.docChanged && value.blockPos !== null) {
              return { blockPos: tr.mapping.map(value.blockPos, -1) };
            }
            return value;
          },
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              if (!view.editable) {
                if (blockHandleKey.getState(view.state)?.blockPos !== null) {
                  view.dispatch(view.state.tr.setMeta(blockHandleKey, { blockPos: null }));
                }
                return false;
              }
              const next = hoveredBlockPos(view, event);
              const current = blockHandleKey.getState(view.state)?.blockPos ?? null;
              if (current !== next) {
                view.dispatch(view.state.tr.setMeta(blockHandleKey, { blockPos: next }));
              }
              return false;
            },
            mouseleave(view, event) {
              const related = event.relatedTarget;
              if (related instanceof Node) {
                const handle = document.querySelector('.kb-block-handle');
                if (handle?.contains(related)) return false;
              }
              if (blockHandleKey.getState(view.state)?.blockPos !== null) {
                view.dispatch(view.state.tr.setMeta(blockHandleKey, { blockPos: null }));
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});

function usePrimaryPointerIsCoarse(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia('(pointer: coarse)');
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(pointer: coarse)').matches,
    () => false,
  );
}

function setHandleBlock(editor: Editor, blockPos: number | null): void {
  if ((blockHandleKey.getState(editor.state)?.blockPos ?? null) === blockPos) return;
  editor.view.dispatch(editor.state.tr.setMeta(blockHandleKey, { blockPos }));
}

export function BlockHandle({ editor, labels }: { editor: Editor; labels: EditorLabels }) {
  const blockPos = useEditorState({
    editor,
    selector: ({ editor: instance }) => blockHandleKey.getState(instance.state)?.blockPos ?? null,
  });
  const handleRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const gesture = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const pressing = useRef(false);
  const coarse = usePrimaryPointerIsCoarse();
  const visible = editor.isEditable && (blockPos !== null || menuOpen);

  useEffect(() => {
    const pos = blockPos;
    const handle = handleRef.current;
    if (pos === null || handle === null) return;
    const reference = blockElement(editor.view, pos);
    if (reference === null) return;
    handle.dataset.placed = 'false';
    return autoUpdate(reference, handle, () => {
      void computePosition(reference, handle, {
        placement: 'left-start',
        strategy: 'fixed',
        middleware: [offset(-32), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        handle.style.left = `${x}px`;
        handle.style.top = `${y}px`;
        handle.dataset.placed = 'true';
      });
    });
  }, [blockPos, editor]);

  // Touch has no hover: the handle follows the caret block and stays while it or its menu is being used.
  useEffect(() => {
    if (!coarse) return undefined;
    const follow = (): void => setHandleBlock(editor, editor.isFocused ? currentBlockPos(editor.state) : null);
    const hide = (): void => {
      if (pressing.current || menuOpen) return;
      setHandleBlock(editor, null);
    };
    editor.on('selectionUpdate', follow);
    editor.on('focus', follow);
    editor.on('blur', hide);
    return () => {
      editor.off('selectionUpdate', follow);
      editor.off('focus', follow);
      editor.off('blur', hide);
    };
  }, [coarse, editor, menuOpen]);

  const node = blockPos === null ? null : editor.state.doc.nodeAt(blockPos);
  const isFirst = blockPos === 0;
  const isLast = blockPos !== null && node !== null && blockPos + node.nodeSize >= editor.state.doc.content.size;

  function dispatch(tr: ReturnType<typeof duplicateBlock> | null): void {
    if (tr === null) return;
    editor.view.dispatch(tr);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    pressing.current = true;
    gesture.current = { x: event.clientX, y: event.clientY, dragged: false };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const current = gesture.current;
    if (current === null || current.dragged) return;
    if (movedPastThreshold(current.x, current.y, event.clientX, event.clientY)) {
      current.dragged = true;
    }
  }

  function onDragStart(event: ReactDragEvent<HTMLButtonElement>): void {
    pressing.current = false;
    if (gesture.current !== null) gesture.current.dragged = true;
    setMenuOpen(false);
    if (blockPos === null || event.dataTransfer === null) return;
    beginBlockDrag(editor.view, blockPos, event.dataTransfer);
  }

  function onClick(event: ReactMouseEvent<HTMLButtonElement>): void {
    pressing.current = false;
    const current = gesture.current;
    gesture.current = null;
    if (current?.dragged === true) return;
    event.preventDefault();
    setMenuOpen((open) => !open);
  }

  return (
    <div
      ref={handleRef}
      data-visible={visible ? 'true' : 'false'}
      className="kb-block-handle"
      onMouseLeave={(event) => {
        if (menuOpen) return;
        const related = event.relatedTarget;
        if (related instanceof Node && editor.view.dom.contains(related)) return;
        editor.view.dispatch(editor.view.state.tr.setMeta(blockHandleKey, { blockPos: null }));
      }}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <div className="relative">
          <DropdownMenuTrigger asChild>
            <span className="pointer-events-none absolute inset-0" aria-hidden="true" />
          </DropdownMenuTrigger>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            draggable={true}
            aria-label={labels.block.handle}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="size-6 cursor-grab px-0 text-fg-muted active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onDragStart={onDragStart}
            onPointerCancel={() => {
              pressing.current = false;
            }}
            onClick={onClick}
          >
            <DotsSixVerticalIcon aria-hidden="true" size={24} />
          </Button>
        </div>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem
            disabled={isFirst}
            onSelect={() => {
              if (blockPos === null) return;
              dispatch(moveBlock(editor.state, blockPos, 'up'));
            }}
          >
            {labels.block.moveUp}
            <Kbd className="ml-auto">{labels.block.moveUpShortcut}</Kbd>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isLast}
            onSelect={() => {
              if (blockPos === null) return;
              dispatch(moveBlock(editor.state, blockPos, 'down'));
            }}
          >
            {labels.block.moveDown}
            <Kbd className="ml-auto">{labels.block.moveDownShortcut}</Kbd>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              if (blockPos === null) return;
              dispatch(duplicateBlock(editor.state, blockPos));
            }}
          >
            {labels.block.duplicate}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-danger"
            onSelect={() => {
              if (blockPos === null) return;
              dispatch(deleteBlock(editor.state, blockPos));
            }}
          >
            {labels.block.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
