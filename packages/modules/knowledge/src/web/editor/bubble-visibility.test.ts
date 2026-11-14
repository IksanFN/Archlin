import type { Editor } from '@tiptap/core';
import type { Selection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { describe, expect, it } from 'vitest';
import { shouldShowTableBubble, shouldShowTextBubble } from './bubble-visibility';

function editor(editable: boolean, active: readonly string[] = []): Editor {
  return {
    isEditable: editable,
    isActive: (name: string) => active.includes(name),
  } as Editor;
}

function textSelection(empty: boolean): Selection {
  return { empty } as Selection;
}

function cellSelection(): Selection {
  return Object.create(CellSelection.prototype, { empty: { value: false } }) as Selection;
}

describe('bubble menu visibility', () => {
  it('hides both menus when the editor is not editable', () => {
    const instance = editor(false, ['table']);
    expect(shouldShowTextBubble(instance, textSelection(false))).toBe(false);
    expect(shouldShowTableBubble(instance, textSelection(true))).toBe(false);
  });

  it('shows the text menu for a non-empty text selection', () => {
    const instance = editor(true);
    expect(shouldShowTextBubble(instance, textSelection(false))).toBe(true);
    expect(shouldShowTableBubble(instance, textSelection(false))).toBe(false);
  });

  it('hides the text menu inside a code block', () => {
    expect(shouldShowTextBubble(editor(true, ['codeBlock']), textSelection(false))).toBe(false);
  });

  it('shows the table menu for a caret inside a table', () => {
    const instance = editor(true, ['table']);
    expect(shouldShowTableBubble(instance, textSelection(true))).toBe(true);
    expect(shouldShowTextBubble(instance, textSelection(true))).toBe(false);
  });

  it('shows the text menu, not the table menu, for text selected in a cell', () => {
    const instance = editor(true, ['table']);
    expect(shouldShowTextBubble(instance, textSelection(false))).toBe(true);
    expect(shouldShowTableBubble(instance, textSelection(false))).toBe(false);
  });

  it('shows the table menu for a cell selection', () => {
    const instance = editor(true, ['table']);
    const selection = cellSelection();
    expect(shouldShowTableBubble(instance, selection)).toBe(true);
    expect(shouldShowTextBubble(instance, selection)).toBe(false);
  });
});
