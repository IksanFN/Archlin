import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { remapDocument } from './duplicate';

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const para = (children: JSONContent[]): JSONContent => ({ type: 'paragraph', content: children });
const wiki = (entityId: string | null, title: string): JSONContent => ({ type: 'wikiLink', attrs: { entityId, title } });
const mention = (entityId: string, title: string): JSONContent => ({ type: 'mention', attrs: { entityId, title } });
const imageNode = (attachmentId: string): JSONContent => ({ type: 'image', attrs: { src: `/files/${attachmentId}`, attachmentId } });
const attachmentBlock = (attachmentId: string): JSONContent => ({ type: 'attachment', attrs: { attachmentId } });

// Every id the document carries, in document order, whatever the node.
function idsIn(node: JSONContent): string[] {
  const own = [node.attrs?.entityId, node.attrs?.attachmentId].filter((value): value is string => typeof value === 'string');
  return [...own, ...(node.content ?? []).flatMap(idsIn)];
}
function imageSrcIn(node: JSONContent): string | undefined {
  if (node.type === 'image') return node.attrs?.src as string;
  return (node.content ?? []).map(imageSrcIn).find((src) => src !== undefined);
}

describe('remapDocument', () => {
  it('points copied links and attachments at the copies and leaves the rest alone', () => {
    const content = doc(para([wiki('P1', 'Anak'), wiki('X', 'Luar'), mention('P1', 'Anak')]), imageNode('A1'), attachmentBlock('A2'));
    const out = remapDocument(content, { pages: new Map([['P1', 'Q1']]), attachments: new Map([['A1', 'B1']]) });
    expect(idsIn(out)).toEqual(['Q1', 'X', 'Q1', 'B1', 'A2']);
    expect(imageSrcIn(out)).toBe('/files/B1');
  });

  it('keeps an unresolved wiki link and the link titles as they are', () => {
    const out = remapDocument(doc(para([wiki(null, 'Belum ada'), wiki('P1', 'Anak')])), {
      pages: new Map([['P1', 'Q1']]),
      attachments: new Map(),
    });
    expect(out.content?.[0]?.content).toEqual([wiki(null, 'Belum ada'), wiki('Q1', 'Anak')]);
  });

  it('does not change the document it is given', () => {
    const content = doc(para([wiki('P1', 'Anak')]), imageNode('A1'));
    const before = JSON.stringify(content);
    remapDocument(content, { pages: new Map([['P1', 'Q1']]), attachments: new Map([['A1', 'B1']]) });
    expect(JSON.stringify(content)).toBe(before);
  });

  it('leaves an https image and any other node untouched', () => {
    const external: JSONContent = { type: 'image', attrs: { src: 'https://contoh.id/a.png', attachmentId: null } };
    const content = doc(external, { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Judul' }] });
    expect(remapDocument(content, { pages: new Map([['P1', 'Q1']]), attachments: new Map([['A1', 'B1']]) })).toEqual(content);
  });

  it('reaches links nested in lists and tables', () => {
    const nested = doc({ type: 'bulletList', content: [{ type: 'listItem', content: [para([mention('P1', 'Anak')])] }] });
    const out = remapDocument(nested, { pages: new Map([['P1', 'Q1']]), attachments: new Map() });
    expect(idsIn(out)).toEqual(['Q1']);
  });
});
