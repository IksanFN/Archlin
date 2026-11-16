import { ATTACHMENT_MAX_BYTES, attachmentUrl } from '@archlin/modules-knowledge/shared';
import type { AttachmentView } from '@archlin/modules-knowledge/shared';
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { loadImageSize } from '../editor/image-dialog';
import type { AttachmentStore } from './attachment-store';
import type { AttachmentLabels } from './labels';
import type { UploadQueue } from './upload-queue';
import { createUploadWidget } from './upload-widget';
import type { UploadWidget } from './upload-widget';

export const uploadPlaceholderKey = new PluginKey<DecorationSet>('kbUploadPlaceholders');

// Only the position is tracked here; progress and failure are drawn on the widget element by the extension.
export type PlaceholderMeta = { add: { id: string; pos: number; name: string } } | { remove: { id: string } };

const IMAGE_MEASURE_TIMEOUT_MS = 10_000;

export function uploadPlaceholderPlugin(createElement: (id: string, name: string) => HTMLElement): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: uploadPlaceholderKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        // Mapping carries each placeholder with the text around it; a deleted spot drops its placeholder.
        let next = set.map(tr.mapping, tr.doc);
        const meta = tr.getMeta(uploadPlaceholderKey) as PlaceholderMeta | undefined;
        if (meta === undefined) return next;
        if ('add' in meta) {
          const { id, pos, name } = meta.add;
          const widget = Decoration.widget(pos, () => createElement(id, name), {
            id,
            key: id,
            side: -1,
            ignoreSelection: true,
            stopEvent: () => true,
          });
          next = next.add(tr.doc, [widget]);
        } else {
          next = next.remove(next.find(undefined, undefined, (spec: { id?: string }) => spec.id === meta.remove.id));
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        return uploadPlaceholderKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}

export function findPlaceholder(state: EditorState, id: string): number | null {
  const set = uploadPlaceholderKey.getState(state);
  const found = set?.find(undefined, undefined, (spec: { id?: string }) => spec.id === id) ?? [];
  return found[0]?.from ?? null;
}

// Indexes rather than files, so the caller keeps the File objects. An empty file is refused like an oversize one.
export function partitionFiles(
  files: readonly { name: string; size: number }[],
  maxBytes: number,
): { accepted: number[]; rejected: number[] } {
  const accepted: number[] = [];
  const rejected: number[] = [];
  files.forEach((file, index) => {
    (file.size > 0 && file.size <= maxBytes ? accepted : rejected).push(index);
  });
  return { accepted, rejected };
}

export interface AttachmentUploadOptions {
  pageId: string;
  queue: UploadQueue;
  store: AttachmentStore;
  labels: { attachments: AttachmentLabels };
  announce(message: string): void;
  notify(message: string): void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    attachmentUpload: {
      insertFiles: (files: File[], pos?: number) => ReturnType;
    };
  }
}

function emptyParagraphRange(state: EditorState, pos: number): { from: number; to: number } | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  return parent.type.name === 'paragraph' && parent.content.size === 0 ? { from: $pos.before(), to: $pos.after() } : null;
}

export const AttachmentUpload = Extension.create<AttachmentUploadOptions, { widgets: Map<string, UploadWidget> }>({
  name: 'attachmentUpload',

  addOptions() {
    return {
      pageId: '',
      queue: undefined as unknown as UploadQueue,
      store: undefined as unknown as AttachmentStore,
      labels: undefined as unknown as AttachmentUploadOptions['labels'],
      announce: () => undefined,
      notify: () => undefined,
    };
  },

  addStorage() {
    return { widgets: new Map<string, UploadWidget>() };
  },

  addCommands() {
    return {
      insertFiles:
        (files, pos) =>
        ({ editor }) => {
          if (!editor.isEditable || files.length === 0) return false;
          void startUploads(editor, this.options, this.storage, files, pos ?? editor.state.selection.from);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { options, storage } = this;
    const labels = options.labels.attachments;

    const removePlaceholder = (view: EditorView, id: string): void => {
      view.dispatch(view.state.tr.setMeta(uploadPlaceholderKey, { remove: { id } } satisfies PlaceholderMeta));
      storage.widgets.delete(id);
    };

    const placeholders = uploadPlaceholderPlugin((id, name) => {
      const widget = createUploadWidget({
        name,
        labels,
        onCancel: () => {
          options.queue.cancel(id);
          removePlaceholder(this.editor.view, id);
        },
        onRetry: () => {
          widget.setUploading();
          options.announce(labels.uploading(name));
          options.queue.retry(id);
        },
        onDiscard: () => {
          options.queue.cancel(id);
          removePlaceholder(this.editor.view, id);
        },
      });
      storage.widgets.set(id, widget);
      return widget.element;
    });

    const overlay = (view: EditorView, on: boolean): void => {
      const root = view.dom.closest('.kb-editor');
      if (root === null) return;
      if (on) root.setAttribute('data-dropping', 'true');
      else root.removeAttribute('data-dropping');
    };

    const handlers = new Plugin({
      key: new PluginKey('kbAttachmentDrop'),
      props: {
        handlePaste: (view, event) => {
          const files = [...(event.clipboardData?.files ?? [])];
          // Office apps put a picture of the selection on the clipboard next to the real html; the html is what the user meant.
          if (!view.editable || files.length === 0 || event.clipboardData?.types.includes('text/html') === true) return false;
          event.preventDefault();
          this.editor.commands.insertFiles(files, view.state.selection.from);
          return true;
        },
        handleDrop: (view, event) => {
          overlay(view, false);
          const files = [...(event.dataTransfer?.files ?? [])];
          if (!view.editable || files.length === 0) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
          this.editor.commands.insertFiles(files, at);
          return true;
        },
        handleDOMEvents: {
          dragenter: (view, event) => {
            if (view.editable && event.dataTransfer?.types.includes('Files') === true) overlay(view, true);
            return false;
          },
          dragleave: (view, event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !view.dom.closest('.kb-editor')?.contains(next)) overlay(view, false);
            return false;
          },
        },
      },
    });

    return [placeholders, handlers];
  },
});

function startUploads(
  editor: Editor,
  options: AttachmentUploadOptions,
  storage: { widgets: Map<string, UploadWidget> },
  files: File[],
  pos: number,
): Promise<void> {
  const labels = options.labels.attachments;
  const { accepted, rejected } = partitionFiles(files, ATTACHMENT_MAX_BYTES);

  for (const index of rejected) {
    const file = files[index];
    if (file === undefined) continue;
    options.notify(file.size === 0 ? labels.fileEmpty : labels.tooLarge(file.name));
  }

  const jobs = accepted.flatMap((index) => {
    const file = files[index];
    return file === undefined ? [] : [file];
  });

  const finishInsert = (id: string, view: AttachmentView, size: { width: number; height: number } | null): void => {
    // The page may have been left while the file was on its way; the attachment is then simply unused.
    if (editor.isDestroyed) return;
    const at = findPlaceholder(editor.state, id);
    storage.widgets.delete(id);
    const tr = editor.state.tr.setMeta(uploadPlaceholderKey, { remove: { id } } satisfies PlaceholderMeta);
    // The user may have deleted the spot while the file was uploading; the attachment then stays listed as unused.
    if (at !== null) {
      const { schema } = editor.state;
      const node =
        view.kind === 'image'
          ? schema.nodes.image?.create({
              src: attachmentUrl(view.id),
              attachmentId: view.id,
              alt: view.filename,
              width: size?.width ?? null,
              height: size?.height ?? null,
            })
          : schema.nodes.attachment?.create({ attachmentId: view.id });
      if (node !== undefined) {
        const empty = emptyParagraphRange(editor.state, at);
        if (empty === null) tr.insert(at, node);
        else tr.replaceWith(empty.from, empty.to, node);
      }
    }
    editor.view.dispatch(tr);
  };

  const tasks = jobs.map(async (file) => {
    const id = crypto.randomUUID();
    const uploadId = crypto.randomUUID();
    editor.view.dispatch(editor.state.tr.setMeta(uploadPlaceholderKey, { add: { id, pos, name: file.name } } satisfies PlaceholderMeta));
    options.announce(labels.uploading(file.name));

    let size: { width: number; height: number } | null = null;
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      try {
        size = await loadImageSize(url, IMAGE_MEASURE_TIMEOUT_MS);
      } catch {
        size = null;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    // The user may have cancelled or discarded the placeholder while the image was measured.
    if (findPlaceholder(editor.state, id) === null) return;

    options.queue.enqueue(
      { id, uploadId, file },
      {
        onProgress: (fraction) => storage.widgets.get(id)?.setProgress(fraction),
        onDone: (view) => {
          options.store.upsert(view);
          finishInsert(id, view, size);
          options.announce(labels.uploaded(file.name));
        },
        onFail: () => {
          storage.widgets.get(id)?.setFailed();
          options.announce(labels.uploadFailed(file.name));
        },
      },
    );
  });

  return Promise.all(tasks).then(() => undefined);
}
