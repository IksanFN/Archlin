import { Node } from '@tiptap/core';

interface SpanLike {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

// A mention always points at a page the author picked, so entityId is never null in a valid document.
export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      entityId: {
        default: null,
        parseHTML: (el: SpanLike) => el.getAttribute('data-entity-id') || null,
        rendered: false,
      },
      title: {
        default: '',
        parseHTML: (el: SpanLike) => (el.textContent ?? '').replace(/^@/, ''),
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },

  renderHTML({ node }) {
    return ['span', { 'data-mention': '', 'data-entity-id': node.attrs.entityId ?? '' }, `@${node.attrs.title}`];
  },

  renderText({ node }) {
    return `@${node.attrs.title}`;
  },
});
