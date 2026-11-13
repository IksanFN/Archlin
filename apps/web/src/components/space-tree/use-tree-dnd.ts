import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachInstruction, extractInstruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';
import type { Instruction, ItemMode } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';
import { useEffect, useRef, type RefObject } from 'react';
import type { DragSource, DropTargetRow } from './instruction-to-move';

const TREE_ITEM = 'tree-item';

export function asTreeDrag(data: Record<string | symbol, unknown>): (DragSource & { type: typeof TREE_ITEM }) | null {
  if (data.type !== TREE_ITEM) return null;
  if (typeof data.entityId !== 'string' || typeof data.spaceId !== 'string') return null;
  if (data.parentId !== null && typeof data.parentId !== 'string') return null;
  return { type: TREE_ITEM, entityId: data.entityId, spaceId: data.spaceId, parentId: data.parentId };
}

export function dropVisual(instruction: Instruction | null): {
  dropState: 'before' | 'after' | 'child' | null;
  dropIndentPx: number;
} {
  if (instruction === null || instruction.type === 'instruction-blocked') {
    return { dropState: null, dropIndentPx: 0 };
  }
  if (instruction.type === 'make-child') return { dropState: 'child', dropIndentPx: 0 };
  if (instruction.type === 'reorder-above') {
    return { dropState: 'before', dropIndentPx: 14 * (instruction.currentLevel - 1) };
  }
  const level = instruction.type === 'reparent' ? instruction.desiredLevel : instruction.currentLevel;
  return { dropState: 'after', dropIndentPx: 14 * (level - 1) };
}

export function useTreeDnd({
  rowRef,
  draggable: canDrag,
  source,
  target,
  level,
  mode,
  expandable,
  expanded,
  onHoverExpand,
  onInstruction,
  onDrop,
  onDraggingChange,
}: {
  rowRef: RefObject<HTMLElement | null>;
  draggable: boolean;
  source?: DragSource;
  target: DropTargetRow;
  level: number;
  mode: ItemMode;
  expandable: boolean;
  expanded: boolean;
  onHoverExpand: () => void;
  onInstruction: (instruction: Instruction | null) => void;
  onDrop: (instruction: Instruction, source: DragSource) => void;
  onDraggingChange?: (dragging: boolean) => void;
}): void {
  const live = useRef({ source, target, expandable, expanded, onHoverExpand, onInstruction, onDrop, onDraggingChange });
  live.current = { source, target, expandable, expanded, onHoverExpand, onInstruction, onDrop, onDraggingChange };

  useEffect(() => {
    const element = rowRef.current;
    if (element === null) return;
    let hoverTimer: number | null = null;

    function clearHover(): void {
      if (hoverTimer !== null) {
        window.clearTimeout(hoverTimer);
        hoverTimer = null;
      }
    }

    const dropTarget = dropTargetForElements({
      element,
      getData({ input, element: el }) {
        return attachInstruction(
          { type: 'tree-target', target: live.current.target },
          { input, element: el, currentLevel: level, indentPerLevel: 14, mode },
        );
      },
      canDrop({ source: drag }) {
        return asTreeDrag(drag.data) !== null;
      },
      onDrag({ self, source: drag }) {
        const instruction = extractInstruction(self.data);
        live.current.onInstruction(instruction);
        if (!live.current.expandable || live.current.expanded || asTreeDrag(drag.data) === null) return;
        if (hoverTimer !== null) return;
        hoverTimer = window.setTimeout(() => {
          hoverTimer = null;
          live.current.onHoverExpand();
        }, 600);
      },
      onDragLeave() {
        clearHover();
        live.current.onInstruction(null);
      },
      onDrop({ self, source: drag }) {
        clearHover();
        live.current.onInstruction(null);
        const instruction = extractInstruction(self.data);
        const from = asTreeDrag(drag.data);
        if (instruction === null || from === null) return;
        live.current.onDrop(instruction, from);
      },
    });

    if (!canDrag) return dropTarget;

    return combine(
      dropTarget,
      draggable({
        element,
        getInitialData: () => {
          const current = live.current.source;
          if (current === undefined) return {};
          return { type: TREE_ITEM, entityId: current.entityId, spaceId: current.spaceId, parentId: current.parentId };
        },
        onDragStart: () => live.current.onDraggingChange?.(true),
        onDrop: () => live.current.onDraggingChange?.(false),
      }),
    );
  }, [canDrag, level, mode, rowRef]);
}
