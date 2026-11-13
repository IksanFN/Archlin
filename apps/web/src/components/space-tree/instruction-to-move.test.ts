import type { Instruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';
import { describe, expect, it } from 'vitest';
import { instructionToMove, type DragSource, type DropTargetRow } from './instruction-to-move';

const source: DragSource = {
  entityId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  spaceId: '11111111-1111-1111-1111-111111111111',
  parentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
};

const target: DropTargetRow = {
  kind: 'entity',
  entityId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  spaceId: '11111111-1111-1111-1111-111111111111',
  parentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  level: 3,
  ancestors: [{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', parentId: null }],
};

function instruction(type: Instruction['type'], extra: Partial<Instruction> = {}): Instruction {
  if (type === 'instruction-blocked') {
    return {
      type,
      desired: { type: 'make-child', currentLevel: 3, indentPerLevel: 14 },
    };
  }
  if (type === 'reparent') {
    return { type, currentLevel: 3, indentPerLevel: 14, desiredLevel: 2, ...extra } as Instruction;
  }
  return { type, currentLevel: 3, indentPerLevel: 14, ...extra } as Instruction;
}

describe('instructionToMove', () => {
  it('reorder-above becomes beforeId', () => {
    expect(instructionToMove(instruction('reorder-above'), source, target)).toEqual({
      entityId: source.entityId,
      targetSpaceId: target.spaceId,
      newParentId: target.parentId,
      beforeId: target.entityId,
      afterId: null,
    });
  });

  it('reorder-below becomes afterId', () => {
    expect(instructionToMove(instruction('reorder-below'), source, target)).toEqual({
      entityId: source.entityId,
      targetSpaceId: target.spaceId,
      newParentId: target.parentId,
      beforeId: null,
      afterId: target.entityId,
    });
  });

  it('make-child appends inside the target', () => {
    expect(instructionToMove(instruction('make-child'), source, target)).toEqual({
      entityId: source.entityId,
      targetSpaceId: target.spaceId,
      newParentId: target.entityId,
      beforeId: null,
      afterId: null,
    });
  });

  it('dropping on a space row moves to its root', () => {
    const space: DropTargetRow = { kind: 'space', spaceId: '22222222-2222-2222-2222-222222222222' };
    expect(instructionToMove(instruction('make-child'), source, space)).toEqual({
      entityId: source.entityId,
      targetSpaceId: space.spaceId,
      newParentId: null,
      beforeId: null,
      afterId: null,
    });
    expect(instructionToMove(instruction('reorder-above'), source, space)).toEqual({
      entityId: source.entityId,
      targetSpaceId: space.spaceId,
      newParentId: null,
      beforeId: null,
      afterId: null,
    });
  });

  it('reparent picks the ancestor at the desired level', () => {
    const nested: DropTargetRow = {
      kind: 'entity',
      entityId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      spaceId: source.spaceId,
      parentId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      level: 4,
      ancestors: [
        { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', parentId: null },
        { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', parentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      ],
    };
    expect(instructionToMove(instruction('reparent', { currentLevel: 4, desiredLevel: 2 }), source, nested)).toEqual({
      entityId: source.entityId,
      targetSpaceId: nested.spaceId,
      newParentId: null,
      beforeId: null,
      afterId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });
    expect(instructionToMove(instruction('reparent', { currentLevel: 4, desiredLevel: 3 }), source, nested)).toEqual({
      entityId: source.entityId,
      targetSpaceId: nested.spaceId,
      newParentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      beforeId: null,
      afterId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    });
  });

  it('blocked instructions and self drops give null', () => {
    expect(instructionToMove(instruction('instruction-blocked'), source, target)).toBeNull();
    expect(
      instructionToMove(instruction('make-child'), source, { ...target, entityId: source.entityId }),
    ).toBeNull();
  });
});
