import { mergeAttributes } from '@tiptap/core';
import { Heading } from '@tiptap/extension-heading';

// Page title is the document h1; body levels 1–3 render as h2–h4.
export const ArchlinHeading = Heading.extend({
  parseHTML() {
    return [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 1 } },
      { tag: 'h3', attrs: { level: 2 } },
      { tag: 'h4', attrs: { level: 3 } },
      { tag: 'h5', attrs: { level: 3 } },
      { tag: 'h6', attrs: { level: 3 } },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const level = this.options.levels.includes(node.attrs.level) ? node.attrs.level : 1;
    return [`h${level + 1}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
}).configure({ levels: [1, 2, 3] });
