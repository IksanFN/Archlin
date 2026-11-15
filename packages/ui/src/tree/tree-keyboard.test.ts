import { describe, expect, it } from 'vitest';
import { treeKeyAction, type VisibleRow } from './tree-keyboard';

const none = { shift: false };

function rows(expandedParent: boolean): VisibleRow[] {
  const parent: VisibleRow = {
    id: 'space',
    level: 1,
    parentId: null,
    expandable: true,
    expanded: expandedParent,
  };
  const child: VisibleRow = { id: 'page', level: 2, parentId: 'space', expandable: true, expanded: false };
  const closed: VisibleRow = { id: 'closed', level: 2, parentId: 'space', expandable: true, expanded: false };
  const leaf: VisibleRow = { id: 'leaf', level: 2, parentId: 'space', expandable: false, expanded: false };
  if (!expandedParent) return [parent, { id: 'other', level: 1, parentId: null, expandable: false, expanded: false }];
  return [parent, child, closed, leaf];
}

describe('treeKeyAction', () => {
  it('ArrowRight opens a closed row and then moves to its first child', () => {
    expect(treeKeyAction(rows(false), 'space', 'ArrowRight', none)).toEqual({ type: 'expand', id: 'space' });
    expect(treeKeyAction(rows(true), 'space', 'ArrowRight', none)).toEqual({ type: 'focus', id: 'page' });
  });

  it('ArrowLeft closes an open row and then moves to the parent', () => {
    expect(treeKeyAction(rows(true), 'space', 'ArrowLeft', none)).toEqual({ type: 'collapse', id: 'space' });
    expect(treeKeyAction(rows(true), 'page', 'ArrowLeft', none)).toEqual({ type: 'focus', id: 'space' });
  });

  it('ArrowDown skips the children of a closed row', () => {
    const visible: VisibleRow[] = [
      { id: 'closed', level: 1, parentId: null, expandable: true, expanded: false },
      { id: 'next', level: 1, parentId: null, expandable: false, expanded: false },
    ];
    expect(treeKeyAction(visible, 'closed', 'ArrowDown', none)).toEqual({ type: 'focus', id: 'next' });
  });

  it('Home and End jump to the first and last visible row', () => {
    const visible = rows(true);
    expect(treeKeyAction(visible, 'page', 'Home', none)).toEqual({ type: 'focus', id: 'space' });
    expect(treeKeyAction(visible, 'page', 'End', none)).toEqual({ type: 'focus', id: 'leaf' });
  });

  it('F2 renames and Delete trashes an entity row', () => {
    const visible = rows(true);
    expect(treeKeyAction(visible, 'page', 'F2', none)).toEqual({ type: 'rename', id: 'page' });
    expect(treeKeyAction(visible, 'page', 'Delete', none)).toEqual({ type: 'trash', id: 'page' });
  });

  it('Delete does nothing on a space row', () => {
    expect(treeKeyAction(rows(true), 'space', 'Delete', none)).toBeNull();
  });

  it('Shift+F10 opens the row menu', () => {
    expect(treeKeyAction(rows(true), 'page', 'F10', { shift: true })).toEqual({ type: 'menu', id: 'page' });
    expect(treeKeyAction(rows(true), 'page', 'ContextMenu', none)).toEqual({ type: 'menu', id: 'page' });
  });
});
