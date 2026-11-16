import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// Links read as their title and any other leaf node as a line break, the same as before links existed.
function leafText(node: ProseMirrorNode): string {
  if (node.type.name === 'wikiLink') return node.attrs.title as string;
  if (node.type.name === 'mention') return `@${node.attrs.title as string}`;
  return '\n';
}

// The server stores this text for versions and search; the editor derives it from the open draft, so both sides share the rule.
export function documentText(doc: ProseMirrorNode): string {
  return doc.textBetween(0, doc.content.size, '\n', leafText);
}
