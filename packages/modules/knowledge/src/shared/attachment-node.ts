import { Node } from '@tiptap/core';

interface DivLike {
  getAttribute(name: string): string | null;
}

// A card for a file the page carries. It only holds the id: name, size and status come from the attachment list.
export const AttachmentNode = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (el: DivLike) => el.getAttribute('data-attachment-id') || null,
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-attachment]' }];
  },

  renderHTML({ node }) {
    return ['div', { 'data-attachment': '', 'data-attachment-id': node.attrs.attachmentId ?? '' }];
  },
});
