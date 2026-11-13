import type { Instruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';
import type { MoveEntityInput } from '@archlin/platform/contracts';

export interface DragSource {
  entityId: string;
  spaceId: string;
  parentId: string | null;
}

export type DropTargetRow =
  | { kind: 'space'; spaceId: string }
  | {
      kind: 'entity';
      entityId: string;
      spaceId: string;
      parentId: string | null;
      level: number;
      ancestors: readonly { id: string; parentId: string | null }[];
    };

function move(
  source: DragSource,
  targetSpaceId: string,
  newParentId: string | null,
  beforeId: string | null,
  afterId: string | null,
): MoveEntityInput {
  return { entityId: source.entityId, targetSpaceId, newParentId, beforeId, afterId };
}

export function instructionToMove(
  instruction: Instruction,
  source: DragSource,
  target: DropTargetRow,
): MoveEntityInput | null {
  if (instruction.type === 'instruction-blocked') return null;
  if (target.kind === 'entity' && target.entityId === source.entityId) return null;
  if (target.kind === 'space') return move(source, target.spaceId, null, null, null);
  if (instruction.type === 'reorder-above') {
    return move(source, target.spaceId, target.parentId, target.entityId, null);
  }
  if (instruction.type === 'reorder-below') {
    return move(source, target.spaceId, target.parentId, null, target.entityId);
  }
  if (instruction.type === 'make-child') {
    return move(source, target.spaceId, target.entityId, null, null);
  }
  const firstAncestorLevel = target.level - target.ancestors.length;
  const index = instruction.desiredLevel - firstAncestorLevel;
  // Indenting left of the root pages is a drop on the space itself.
  if (index < 0 || instruction.desiredLevel <= 1) {
    return move(source, target.spaceId, null, null, null);
  }
  const ancestor = target.ancestors[index];
  if (ancestor === undefined) return null;
  return move(source, target.spaceId, ancestor.parentId, null, ancestor.id);
}
