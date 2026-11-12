import { Node } from '@tiptap/core';

export const CALLOUT_VARIANTS = ['info', 'warning', 'danger', 'success'] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el: { getAttribute(name: string): string | null }) => el.getAttribute('data-variant'),
        rendered: true,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ node }) {
    return ['div', { 'data-callout': '', 'data-variant': node.attrs.variant }, 0];
  },
});
