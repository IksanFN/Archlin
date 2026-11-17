import { getDocumentSchema } from '@archlin/modules-knowledge/shared';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { findPlaceholder, partitionFiles, uploadPlaceholderKey, uploadPlaceholderPlugin } from './upload-plugin';

function stateWithText(text: string): EditorState {
  const schema = getDocumentSchema();
  const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))]);
  return EditorState.create({ schema, doc, plugins: [uploadPlaceholderPlugin(() => ({}) as HTMLElement)] });
}

describe('upload placeholders', () => {
  it('findPlaceholder follows a placeholder through edits before it', () => {
    let state = stateWithText('halo dunia');
    state = state.apply(state.tr.setMeta(uploadPlaceholderKey, { add: { id: 'u1', pos: 6, name: 'a.pdf' } }));
    state = state.apply(state.tr.insertText('XYZ', 1));
    expect(findPlaceholder(state, 'u1')).toBe(9);
    state = state.apply(state.tr.setMeta(uploadPlaceholderKey, { remove: { id: 'u1' } }));
    expect(findPlaceholder(state, 'u1')).toBeNull();
  });

  it('a placeholder whose surrounding text is deleted is gone', () => {
    let state = stateWithText('halo dunia');
    state = state.apply(state.tr.setMeta(uploadPlaceholderKey, { add: { id: 'u1', pos: 6, name: 'a.pdf' } }));
    state = state.apply(state.tr.delete(2, 10));
    expect(findPlaceholder(state, 'u1')).toBeNull();
  });

  it('keeps two placeholders apart by id', () => {
    let state = stateWithText('halo dunia');
    state = state.apply(state.tr.setMeta(uploadPlaceholderKey, { add: { id: 'u1', pos: 2, name: 'a.pdf' } }));
    state = state.apply(state.tr.setMeta(uploadPlaceholderKey, { add: { id: 'u2', pos: 8, name: 'b.pdf' } }));
    state = state.apply(state.tr.setMeta(uploadPlaceholderKey, { remove: { id: 'u1' } }));
    expect(findPlaceholder(state, 'u1')).toBeNull();
    expect(findPlaceholder(state, 'u2')).toBe(8);
  });
});

describe('partitionFiles', () => {
  it('rejects empty files and files over the limit', () => {
    expect(partitionFiles([{ name: 'a', size: 10 }, { name: 'b', size: 0 }, { name: 'c', size: 101 }], 100)).toEqual({
      accepted: [0],
      rejected: [1, 2],
    });
  });

  it('accepts a file exactly at the limit', () => {
    expect(partitionFiles([{ name: 'a', size: 100 }], 100)).toEqual({ accepted: [0], rejected: [] });
  });
});
