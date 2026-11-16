import { isAllowedImageSrc, isAllowedLink } from '@archlin/modules-knowledge/shared';
import { Extension, type JSONContent } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const HEADING = /^#{1,6}\s/;
const BULLET = /^[-*+]\s/;
const ORDERED = /^\d+\.\s/;
const QUOTE = /^>\s/;
const TASK = /^- \[[ x]\]\s/;
const FENCE = /^```/;
const TABLE_ROW = /^\|.*\|$/;
const TABLE_DIVIDER = /^\|?\s*:?-{3,}/;

export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    if (HEADING.test(line) || BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line) || TASK.test(line) || FENCE.test(line)) {
      return true;
    }
    const next = lines[i + 1];
    if (next !== undefined && TABLE_ROW.test(line) && TABLE_DIVIDER.test(next)) return true;
  }
  return false;
}

function sanitizeNode(node: JSONContent): JSONContent | null {
  if (node.type === 'image') {
    const src: unknown = node.attrs?.src;
    return typeof src === 'string' && isAllowedImageSrc(src, null) ? node : null;
  }
  const next: JSONContent = { ...node };
  if (node.marks !== undefined) {
    const marks = node.marks.filter((mark) => {
      if (mark.type !== 'link') return true;
      const href: unknown = mark.attrs?.href;
      return typeof href === 'string' && isAllowedLink(href);
    });
    if (marks.length > 0) next.marks = marks;
    else delete next.marks;
  }
  if (node.content !== undefined) {
    next.content = node.content.flatMap((child) => sanitizeNode(child) ?? []);
  }
  return next;
}

// Markdown can name any image or link URL; the server rejects unsafe ones, so they must not reach the editor at all.
export function sanitizePastedContent(content: JSONContent | JSONContent[]): JSONContent[] {
  return (Array.isArray(content) ? content : [content]).flatMap((node) => sanitizeNode(node) ?? []);
}

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addExtensions() {
    return [Markdown];
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste(_view, event) {
            const clipboard = event.clipboardData;
            if (clipboard === null) return false;
            if (clipboard.getData('text/html').length > 0) return false;
            const text = clipboard.getData('text/plain');
            if (!looksLikeMarkdown(text)) return false;
            const parsed = editor.markdown?.parse(text);
            if (parsed === undefined) return false;
            const content = parsed.type === 'doc' ? parsed.content : parsed;
            if (content === undefined) return false;
            editor.commands.insertContent(sanitizePastedContent(content));
            return true;
          },
        },
      }),
    ];
  },
});
