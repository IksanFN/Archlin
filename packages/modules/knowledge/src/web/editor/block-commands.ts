import { Extension } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';

export function currentBlockPos(state: EditorState): number | null {
  const $from = state.selection.$from;
  if ($from.depth < 1) return null;
  return $from.before(1);
}

export function moveBlock(state: EditorState, blockPos: number, direction: 'up' | 'down'): Transaction | null {
  const $block = state.doc.resolve(blockPos);
  if ($block.depth !== 0) return null;
  const node = state.doc.nodeAt(blockPos);
  if (node === null) return null;
  const index = $block.index();
  if (direction === 'up') {
    if (index === 0) return null;
    const prev = state.doc.child(index - 1);
    const prevPos = blockPos - prev.nodeSize;
    // Delete the neighbour, not the moved node, so a caret inside the node maps with it.
    return state.tr.delete(prevPos, blockPos).insert(prevPos + node.nodeSize, prev);
  }
  if (index === state.doc.childCount - 1) return null;
  const next = state.doc.child(index + 1);
  const nextPos = blockPos + node.nodeSize;
  return state.tr.delete(nextPos, nextPos + next.nodeSize).insert(blockPos, next);
}

export function duplicateBlock(state: EditorState, blockPos: number): Transaction {
  const node = state.doc.nodeAt(blockPos);
  if (node === null) return state.tr;
  return state.tr.insert(blockPos + node.nodeSize, node.copy(node.content));
}

export function deleteBlock(state: EditorState, blockPos: number): Transaction {
  const node = state.doc.nodeAt(blockPos);
  if (node === null) return state.tr;
  const from = blockPos;
  const to = blockPos + node.nodeSize;
  if (state.doc.childCount === 1) {
    const paragraph = state.schema.nodes.paragraph;
    if (paragraph === undefined) return state.tr;
    return state.tr.replaceWith(from, to, paragraph.create());
  }
  return state.tr.delete(from, to);
}

function moveCurrentBlock(direction: 'up' | 'down') {
  return ({ editor }: { editor: { state: EditorState; view: { dispatch: (tr: Transaction) => void } } }) => {
    const pos = currentBlockPos(editor.state);
    if (pos === null) return false;
    const tr = moveBlock(editor.state, pos, direction);
    if (tr === null) return false;
    editor.view.dispatch(tr);
    return true;
  };
}

export const BlockCommands = Extension.create({
  name: 'blockCommands',

  addKeyboardShortcuts() {
    return {
      'Alt-Shift-ArrowUp': moveCurrentBlock('up'),
      'Alt-Shift-ArrowDown': moveCurrentBlock('down'),
    };
  },
});
