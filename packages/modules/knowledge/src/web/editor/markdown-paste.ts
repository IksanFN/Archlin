import { Extension } from '@tiptap/core';
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
            editor.commands.insertContent(content);
            return true;
          },
        },
      }),
    ];
  },
});
