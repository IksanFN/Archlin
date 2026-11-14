import type { Editor, JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo } from 'react';
import { editorExtensions } from './extensions';
import type { EditorLabels } from './labels';
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

  return (
    <div className="kb-editor">
      {editor === null ? null : (
        <>
          <TextBubbleMenu editor={editor} labels={labels} />
          <TableBubbleMenu editor={editor} labels={labels} />
        </>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
