import { LINK_SNIPPET_MAX } from '@archlin/platform/contracts';
import type { LinkRef } from '@archlin/platform/contracts';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const CONTEXT_CHARS = 110;
const WHITESPACE = /\s/;

function inlineText(node: ProseMirrorNode): string {
  if (node.isText) return node.text ?? '';
  if (node.type.name === 'wikiLink') return `[[${node.attrs.title as string}]]`;
  if (node.type.name === 'mention') return `@${node.attrs.title as string}`;
  return ' ';
}

const isSpace = (char: string | undefined): boolean => char === undefined || WHITESPACE.test(char);

// The paragraph text around one link, cut at word boundaries so a snippet never starts or ends in the middle of a word.
function snippetAround(parent: ProseMirrorNode, index: number): string {
  const pieces: string[] = [];
  parent.forEach((child) => pieces.push(inlineText(child)));
  const before = pieces.slice(0, index).join('');
  const own = pieces[index] ?? '';
  const full = before + own + pieces.slice(index + 1).join('');
  const start = before.length;
  const end = start + own.length;

  let from = Math.max(0, start - CONTEXT_CHARS);
  let to = Math.min(full.length, end + CONTEXT_CHARS);
  if (from > 0 && !isSpace(full[from - 1]) && !isSpace(full[from])) {
    for (let i = from; i < start; i += 1) {
      if (isSpace(full[i])) {
        from = i + 1;
        break;
      }
    }
  }
  if (to < full.length && !isSpace(full[to - 1]) && !isSpace(full[to])) {
    for (let i = to - 1; i >= end; i -= 1) {
      if (isSpace(full[i])) {
        to = i;
        break;
      }
    }
  }
  const snippet = `${from > 0 ? '…' : ''}${full.slice(from, to).trim()}${to < full.length ? '…' : ''}`;
  return snippet.slice(0, LINK_SNIPPET_MAX);
}

export function documentLinkRefs(doc: ProseMirrorNode): LinkRef[] {
  const refs: LinkRef[] = [];
  doc.descendants((node, _pos, parent, index) => {
    const name = node.type.name;
    if ((name !== 'wikiLink' && name !== 'mention') || parent === null) return;
    refs.push({
      kind: name === 'wikiLink' ? 'wikilink' : 'mention',
      targetId: (node.attrs.entityId as string | null) ?? null,
      targetTitle: node.attrs.title as string,
      snippet: snippetAround(parent, index),
    });
  });
  return refs;
}
