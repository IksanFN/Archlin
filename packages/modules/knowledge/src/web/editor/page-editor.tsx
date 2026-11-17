import type { Editor, JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { toast } from '@archlin/ui/components/sonner';
import type { PageEditorAttachments } from '../attachments/page-editor-attachments';
import { UnresolvedLinkPopover } from '../links/unresolved-popover';
import { OPEN_LINK_POPOVER } from '../links/wiki-link-view';
import type { OpenLinkPopoverDetail } from '../links/wiki-link-view';
import type { PageEditorLinks } from '../links/page-editor-links';
import { BlockHandle } from './block-handle';
import { editorExtensions } from './extensions';
import { FindPanel } from './find-panel';
import { ImageDialog } from './image-dialog';
import type { EditorLabels } from './labels';
import { OPEN_FILE_PICKER, OPEN_IMAGE_DIALOG } from './slash-items';
import { TableBubbleMenu } from './table-bubble-menu';
import { TextBubbleMenu } from './text-bubble-menu';

// Room for the 24px block handle and the 8px between it and the text.
const HANDLE_GUTTER_PX = 32;
// Space the handle keeps from the edge of whatever clips the page.
const HANDLE_EDGE_PX = 8;
const GUTTER_STYLE: CSSProperties & Record<'--kb-handle-gutter', string> = { '--kb-handle-gutter': `${HANDLE_GUTTER_PX}px` };

function clippingAncestor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).overflowX !== 'visible') return node;
  }
  return null;
}

export function PageEditor({
  content,
  editable,
  labels,
  links,
  attachments,
  onChange,
  onEditorReady,
}: {
  content: JSONContent;
  editable: boolean;
  labels: EditorLabels;
  links?: PageEditorLinks;
  attachments?: PageEditorAttachments;
  onChange: (doc: JSONContent) => void;
  onEditorReady?: (editor: Editor) => void;
}) {
  const [imageOpen, setImageOpen] = useState(false);
  const [linkPopover, setLinkPopover] = useState<OpenLinkPopoverDetail | null>(null);
  const [gutter, setGutter] = useState<'inside' | 'outside'>('inside');
  const rootRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extensions = useMemo(
    () =>
      editorExtensions(labels, {
        links,
        attachments:
          attachments === undefined ? undefined : { ...attachments, announce: setAnnouncement, notify: (message) => toast.error(message) },
      }),
    [labels, links, attachments],
  );
  const editor = useEditor({
    extensions,
    content,
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { 'aria-label': labels.body } },
    // Tiptap also emits update while loading content, with no steps; reporting that would mark an untouched page dirty.
    onUpdate: ({ editor: instance, transaction }) => {
      if (!transaction.docChanged) return;
      onChange(instance.getJSON());
    },
    onCreate: ({ editor: instance }) => {
      onEditorReady?.(instance);
    },
  });

  useEffect(() => {
    if (editor === null) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  // The gutter goes left of the text where the page leaves room for it, and pushes the text over where it does not.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    const clip = clippingAncestor(root);
    const update = (): void => {
      const edge = clip === null ? 0 : clip.getBoundingClientRect().left;
      const room = root.getBoundingClientRect().left - edge;
      setGutter(room >= HANDLE_GUTTER_PX + HANDLE_EDGE_PX ? 'outside' : 'inside');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    observer.observe(clip ?? document.documentElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    function onOpen(): void {
      setImageOpen(true);
    }
    function onOpenLink(event: Event): void {
      setLinkPopover((event as CustomEvent<OpenLinkPopoverDetail>).detail);
    }
    function onOpenFiles(): void {
      fileInputRef.current?.click();
    }
    root.addEventListener(OPEN_IMAGE_DIALOG, onOpen);
    root.addEventListener(OPEN_LINK_POPOVER, onOpenLink);
    root.addEventListener(OPEN_FILE_PICKER, onOpenFiles);
    return () => {
      root.removeEventListener(OPEN_IMAGE_DIALOG, onOpen);
      root.removeEventListener(OPEN_LINK_POPOVER, onOpenLink);
      root.removeEventListener(OPEN_FILE_PICKER, onOpenFiles);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="kb-editor"
      data-gutter={gutter}
      style={GUTTER_STYLE}
    >
      {editor === null ? null : (
        <>
          <FindPanel editor={editor} labels={labels} />
          <TextBubbleMenu editor={editor} labels={labels} />
          <TableBubbleMenu editor={editor} labels={labels} />
          <BlockHandle editor={editor} labels={labels} />
        </>
      )}
      <EditorContent editor={editor} />
      {links === undefined ? null : (
        <UnresolvedLinkPopover
          editor={editor}
          links={links}
          labels={labels.links}
          detail={linkPopover}
          onClose={() => setLinkPopover(null)}
        />
      )}
      <ImageDialog
        open={imageOpen}
        onOpenChange={setImageOpen}
        onInsert={(attrs) => {
          editor?.chain().focus().setImage(attrs).run();
        }}
        onUpload={
          attachments === undefined
            ? undefined
            : (file) => {
                editor?.chain().focus().insertFiles([file]).run();
              }
        }
        labels={labels}
      />
      {attachments === undefined ? null : (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = '';
              if (files.length > 0) editor?.chain().focus().insertFiles(files).run();
            }}
          />
          <div className="kb-drop-overlay" aria-hidden="true">
            {labels.attachments.dropHere}
          </div>
          <div role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>
        </>
      )}
    </div>
  );
}
