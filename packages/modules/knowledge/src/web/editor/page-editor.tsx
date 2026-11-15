import type { Editor, JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { BlockHandle } from './block-handle';
import { editorExtensions } from './extensions';
import { FindPanel } from './find-panel';
import { ImageDialog } from './image-dialog';
import type { EditorLabels } from './labels';
import { OPEN_IMAGE_DIALOG } from './slash-items';
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
  onChange,
  onEditorReady,
}: {
  content: JSONContent;
  editable: boolean;
  labels: EditorLabels;
  onChange: (doc: JSONContent) => void;
  onEditorReady?: (editor: Editor) => void;
}) {
  const [imageOpen, setImageOpen] = useState(false);
  const [gutter, setGutter] = useState<'inside' | 'outside'>('inside');
  const rootRef = useRef<HTMLDivElement>(null);
  const extensions = useMemo(() => editorExtensions(labels), [labels]);
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
    root.addEventListener(OPEN_IMAGE_DIALOG, onOpen);
    return () => root.removeEventListener(OPEN_IMAGE_DIALOG, onOpen);
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
      <ImageDialog
        open={imageOpen}
        onOpenChange={setImageOpen}
        onInsert={(attrs) => {
          editor?.chain().focus().setImage(attrs).run();
        }}
        labels={labels}
      />
    </div>
  );
}
