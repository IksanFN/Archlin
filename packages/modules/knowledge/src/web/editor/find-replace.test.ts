import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { getDocumentSchema } from '../../shared/document-schema';
import { findMatches, replaceAll } from './find-replace';

const schema = getDocumentSchema();

function doc(content: object) {
  return schema.nodeFromJSON({ type: 'doc', content });
}

describe('find and replace', () => {
  it('finds matches inside one block across marks', () => {
    const node = doc([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'hel', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'lo world' },
        ],
      },
    ]);
    expect(findMatches(node, 'hello', false)).toEqual([{ from: 1, to: 6 }]);
  });

  it('does not match across two paragraphs', () => {
    const node = doc([
      { type: 'paragraph', content: [{ type: 'text', text: 'hel' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'lo' }] },
    ]);
    expect(findMatches(node, 'hello', false)).toEqual([]);
  });

  it('respects case sensitivity', () => {
    const node = doc([{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }]);
    expect(findMatches(node, 'hello', false)).toEqual([{ from: 1, to: 6 }]);
    expect(findMatches(node, 'hello', true)).toEqual([]);
    expect(findMatches(node, 'Hello', true)).toEqual([{ from: 1, to: 6 }]);
  });

  it('replaceAll replaces every match and keeps positions valid', () => {
    const state = EditorState.create({
      schema,
      doc: doc([{ type: 'paragraph', content: [{ type: 'text', text: 'foo bar foo' }] }]),
    });
    const matches = findMatches(state.doc, 'foo', true);
    const next = state.apply(replaceAll(state, matches, 'qux'));
    expect(next.doc.textContent).toBe('qux bar qux');
  });

  it('a hard break does not shift positions', () => {
    const node = doc([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'foo' },
          { type: 'hardBreak' },
          { type: 'text', text: 'foo' },
        ],
      },
    ]);
    expect(findMatches(node, 'foo', true)).toEqual([
      { from: 1, to: 4 },
      { from: 5, to: 8 },
    ]);
  });
});
