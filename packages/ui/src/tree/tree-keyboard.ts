export interface VisibleRow {
  id: string;
  level: number;
  parentId: string | null;
  expandable: boolean;
  expanded: boolean;
}

export type TreeKeyAction =
  | { type: 'focus'; id: string }
  | { type: 'expand'; id: string }
  | { type: 'collapse'; id: string }
  | { type: 'open'; id: string }
  | { type: 'rename'; id: string }
  | { type: 'menu'; id: string }
  | { type: 'trash'; id: string }
  | null;

function at(rows: readonly VisibleRow[], id: string): { row: VisibleRow; index: number } | null {
  const index = rows.findIndex((row) => row.id === id);
  const row = rows[index];
  if (index < 0 || row === undefined) return null;
  return { row, index };
}

function focusAt(rows: readonly VisibleRow[], index: number): TreeKeyAction {
  const row = rows[index];
  return row === undefined ? null : { type: 'focus', id: row.id };
}

export function treeKeyAction(
  rows: readonly VisibleRow[],
  currentId: string,
  key: string,
  modifiers: { shift: boolean },
): TreeKeyAction {
  const current = at(rows, currentId);
  if (current === null) return null;
  const { row, index } = current;

  if (key === 'ArrowDown') return focusAt(rows, index + 1);
  if (key === 'ArrowUp') return focusAt(rows, index - 1);
  if (key === 'Home') return focusAt(rows, 0);
  if (key === 'End') return focusAt(rows, rows.length - 1);

  if (key === 'ArrowRight') {
    if (row.expandable && !row.expanded) return { type: 'expand', id: row.id };
    const child = rows[index + 1];
    if (row.expanded && child !== undefined && child.parentId === row.id) return { type: 'focus', id: child.id };
    return null;
  }

  if (key === 'ArrowLeft') {
    if (row.expandable && row.expanded) return { type: 'collapse', id: row.id };
    if (row.parentId === null) return null;
    return { type: 'focus', id: row.parentId };
  }

  if (key === 'Enter') return { type: 'open', id: row.id };
  if (key === 'F2') return { type: 'rename', id: row.id };
  if (key === 'ContextMenu' || (key === 'F10' && modifiers.shift)) return { type: 'menu', id: row.id };
  // Space rows sit at the root (no parent); deleting them would archive, which is a menu action.
  if (key === 'Delete') return row.parentId === null ? null : { type: 'trash', id: row.id };
  return null;
}
