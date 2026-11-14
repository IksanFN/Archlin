import type { Editor } from '@tiptap/core';
import type { Selection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';

export function shouldShowTextBubble(editor: Editor, selection: Selection): boolean {
  if (!editor.isEditable) return false;
  if (editor.isActive('codeBlock')) return false;
  if (selection.empty) return false;
  if (selection instanceof CellSelection) return false;
  return true;
}

export function shouldShowTableBubble(editor: Editor, selection: Selection): boolean {
  if (!editor.isEditable) return false;
  if (!editor.isActive('table')) return false;
  if (selection instanceof CellSelection) return true;
  return selection.empty;
}

export function playBubbleFadeIn(element: HTMLElement): void {
  element.style.transition = 'none';
  element.style.opacity = '0';
  void element.offsetWidth;
  element.style.transition = 'opacity 120ms var(--grok-motion-ease-out)';
  element.style.opacity = '1';
}
