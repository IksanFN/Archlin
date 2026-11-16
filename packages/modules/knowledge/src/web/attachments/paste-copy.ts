import { attachmentUrl } from '@archlin/modules-knowledge/shared';
import { Extension } from '@tiptap/core';
import type { Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { AttachmentStore } from './attachment-store';
import type { AttachmentLabels } from './labels';

const ATTACHMENT_NODES = new Set(['image', 'attachment']);

function attachmentIdOf(node: { type: { name: string }; attrs: Record<string, unknown> }): string | null {
  if (!ATTACHMENT_NODES.has(node.type.name)) return null;
  const id = node.attrs.attachmentId;
  return typeof id === 'string' && id !== '' ? id : null;
}

// Ids in a pasted slice that this page does not own: unknown to it, or listed under another page.
export function foreignAttachmentIds(slice: Slice, store: AttachmentStore, pageId: string): string[] {
  const found = new Set<string>();
  slice.content.descendants((node) => {
    const id = attachmentIdOf(node);
    if (id === null) return;
    const known = store.get(id);
    if (known === undefined || known.pageId !== pageId) found.add(id);
  });
  return [...found];
}

// Positions do not move: both nodes are atoms and only attributes change.
export function replaceAttachmentIds(tr: Transaction, map: Readonly<Record<string, string>>): Transaction {
  tr.doc.descendants((node, pos) => {
    const id = attachmentIdOf(node);
    const next = id === null ? undefined : map[id];
    if (next === undefined) return;
    const attrs: Record<string, unknown> = { ...node.attrs, attachmentId: next };
    if (node.type.name === 'image') attrs.src = attachmentUrl(next);
    tr.setNodeMarkup(pos, undefined, attrs);
  });
  return tr;
}

export interface PasteAttachmentCopyOptions {
  pageId: string;
  store: AttachmentStore;
  copy(ids: string[]): Promise<Record<string, string>>;
  refresh(): Promise<void>;
  notify(message: string): void;
  labels: { attachments: AttachmentLabels };
}

// A pasted card still points at the page it was copied from, so purging that page would break this one; each is copied here instead.
export const PasteAttachmentCopy = Extension.create<PasteAttachmentCopyOptions>({
  name: 'pasteAttachmentCopy',

  addOptions() {
    return {
      pageId: '',
      store: undefined as unknown as AttachmentStore,
      copy: () => Promise.resolve({}),
      refresh: () => Promise.resolve(),
      notify: () => undefined,
      labels: undefined as unknown as PasteAttachmentCopyOptions['labels'],
    };
  },

  addProseMirrorPlugins() {
    const { pageId, store, copy, refresh, notify, labels } = this.options;

    async function copyForeign(view: EditorView, ids: string[]): Promise<void> {
      try {
        const map = await copy(ids);
        // The list is refreshed first so a card shows its new file the moment its id changes.
        await refresh().catch(() => undefined);
        if (!view.isDestroyed) view.dispatch(replaceAttachmentIds(view.state.tr, map));
      } catch {
        notify(labels.attachments.copyFailed);
      }
    }

    return [
      new Plugin({
        key: new PluginKey('kbPasteAttachmentCopy'),
        props: {
          transformPasted(slice, view) {
            const ids = foreignAttachmentIds(slice, store, pageId);
            if (ids.length > 0 && view.editable) void copyForeign(view, ids);
            return slice;
          },
        },
      }),
    ];
  },
});
