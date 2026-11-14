import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { getDocumentSchema } from '../../shared/document-schema';
import { deleteBlock, duplicateBlock, moveBlock } from './block-commands';

const schema = getDocumentSchema();

function stateFrom(content: object): EditorState {
  return EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content }) });
}

describe('block commands', () => {
  it('moves a block down past its neighbour', () => {
    const state = stateFrom([
      { type: 'paragraph', content: [{ type: 'text', text: 'satu' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'dua' }] },
    ]);
    const tr = moveBlock(state, 0, 'down');
    expect(tr).not.toBeNull();
    if (tr === null) return;
    const next = state.apply(tr);
    expect(next.doc.child(0)?.textContent).toBe('dua');
    expect(next.doc.child(1)?.textContent).toBe('satu');
  });

  it('moving the first block up returns null', () => {
    const state = stateFrom([{ type: 'paragraph', content: [{ type: 'text', text: 'satu' }] }]);
    expect(moveBlock(state, 0, 'up')).toBeNull();
  });

  it('duplicates a block right after itself', () => {
    const state = stateFrom([
      { type: 'paragraph', content: [{ type: 'text', text: 'satu' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'dua' }] },
    ]);
    const next = state.apply(duplicateBlock(state, 0));
    expect(next.doc.childCount).toBe(3);
    expect(next.doc.child(0)?.textContent).toBe('satu');
    expect(next.doc.child(1)?.textContent).toBe('satu');
    expect(next.doc.child(2)?.textContent).toBe('dua');
  });

  it('deletes a block and leaves an empty paragraph when it was the only one', () => {
    const state = stateFrom([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'judul' }] },
    ]);
    const next = state.apply(deleteBlock(state, 0));
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0)?.type.name).toBe('paragraph');
    expect(next.doc.child(0)?.textContent).toBe('');
  });
});
