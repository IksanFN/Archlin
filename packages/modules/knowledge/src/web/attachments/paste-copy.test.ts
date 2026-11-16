import { getDocumentSchema } from '@archlin/modules-knowledge/shared';
import type { AttachmentView } from '@archlin/modules-knowledge/shared';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { createAttachmentStore } from './attachment-store';
import { foreignAttachmentIds, replaceAttachmentIds } from './paste-copy';

const schema = getDocumentSchema();

function nodeType(name: string): NodeType {
  const type = schema.nodes[name];
  if (type === undefined) throw new Error(`schema has no ${name} node`);
  return type;
}

const viewOf = (id: string, pageId: string): AttachmentView => ({
  id,
  pageId,
  filename: 'a.pdf',
  mime: 'application/pdf',
  size: 10,
  kind: 'pdf',
  extraction: 'pending',
  referenced: true,
  trashed: false,
  createdAt: '2026-11-16T00:00:00Z',
});

const imageNode = (id: string): ProseMirrorNode =>
  nodeType('image').create({ src: `/files/${id}`, attachmentId: id, alt: 'x', width: 1, height: 1 });
const attachmentBlock = (id: string): ProseMirrorNode => nodeType('attachment').create({ attachmentId: id });
const sliceOf = (...nodes: ProseMirrorNode[]): Slice => new Slice(Fragment.from(nodes), 0, 0);
const stateOf = (...nodes: ProseMirrorNode[]): EditorState =>
  EditorState.create({ schema, doc: schema.node('doc', null, nodes) });

function attachmentIdsIn(doc: ProseMirrorNode): string[] {
  const ids: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'image' || node.type.name === 'attachment') ids.push(node.attrs.attachmentId as string);
  });
  return ids;
}

function imageSrcIn(doc: ProseMirrorNode): string {
  let src = '';
  doc.descendants((node) => {
    if (node.type.name === 'image') src = node.attrs.src as string;
  });
  return src;
}

describe('foreignAttachmentIds', () => {
  it('lists ids that belong to another page or are unknown', () => {
    const store = createAttachmentStore([viewOf('A1', 'P1'), viewOf('A2', 'P2')]);
    const slice = sliceOf(imageNode('A1'), attachmentBlock('A2'), attachmentBlock('A9'), attachmentBlock('A2'));
    expect(foreignAttachmentIds(slice, store, 'P1')).toEqual(['A2', 'A9']);
  });

  it('finds attachments nested inside other blocks', () => {
    const store = createAttachmentStore([]);
    const quote = nodeType('blockquote').create(null, [attachmentBlock('A5')]);
    expect(foreignAttachmentIds(sliceOf(quote), store, 'P1')).toEqual(['A5']);
  });

  it('is empty when the slice carries no attachment', () => {
    const store = createAttachmentStore([]);
    expect(foreignAttachmentIds(sliceOf(nodeType('paragraph').create(null, schema.text('halo'))), store, 'P1')).toEqual([]);
  });
});

describe('replaceAttachmentIds', () => {
  it('rewrites ids and the image source', () => {
    const state = stateOf(imageNode('A2'), attachmentBlock('A2'), attachmentBlock('A3'));
    const next = state.apply(replaceAttachmentIds(state.tr, { A2: 'B2' }));
    expect(attachmentIdsIn(next.doc)).toEqual(['B2', 'B2', 'A3']);
    expect(imageSrcIn(next.doc)).toBe('/files/B2');
  });

  it('leaves a document untouched when the map is empty', () => {
    const state = stateOf(attachmentBlock('A3'));
    const next = state.apply(replaceAttachmentIds(state.tr, {}));
    expect(next.doc.eq(state.doc)).toBe(true);
  });
});
