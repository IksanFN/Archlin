import { Node } from '@tiptap/core';

interface AnchorLike {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

// entityId stays null until the server resolves the title, so the stored node never changes on read.
export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      entityId: {
        default: null,
        parseHTML: (el: AnchorLike) => el.getAttribute('data-entity-id') || null,
        rendered: false,
      },
      title: {
        default: '',
        parseHTML: (el: AnchorLike) => el.textContent ?? '',
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-wiki-link]' }];
  },

  renderHTML({ node }) {
    return ['a', { 'data-wiki-link': '', 'data-entity-id': node.attrs.entityId ?? '' }, node.attrs.title];
  },

  renderText({ node }) {
    return node.attrs.title as string;
  },
});
