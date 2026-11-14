import type { Editor, JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BlockHandle } from './block-handle';
import { editorExtensions } from './extensions';
import { FindPanel } from './find-panel';
import { ImageDialog } from './image-dialog';
import type { EditorLabels } from './labels';
import { OPEN_IMAGE_DIALOG } from './slash-items';
import { TableBubbleMenu } from './table-bubble-menu';
import { TextBubbleMenu } from './text-bubble-menu';

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
  const rootRef = useRef<HTMLDivElement>(null);
  const extensions = useMemo(() => editorExtensions(labels), [labels]);
  const editor = useEditor({
    extensions,
    content,
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: instance }) => {
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
    <div ref={rootRef} className="kb-editor">
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
