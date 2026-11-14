import { Button } from '@archlin/ui/components/button';
import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { useEditorState } from '@tiptap/react';
import { useRef } from 'react';
import type { MouseEvent } from 'react';
import { playBubbleFadeIn, shouldShowTableBubble } from './bubble-visibility';
import type { EditorLabels } from './labels';

function keepSelection(event: MouseEvent): void {
  event.preventDefault();
}

export function TableBubbleMenu({ editor, labels }: { editor: Editor; labels: EditorLabels }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const inHeader = useEditorState({
    editor,
    selector: ({ editor: instance }) => instance.isActive('tableHeader'),
  });

  return (
    <BubbleMenu
      ref={menuRef}
      editor={editor}
      pluginKey="kb-table-bubble"
      options={{
        placement: 'top',
        offset: 8,
        onShow: () => {
          if (menuRef.current !== null) playBubbleFadeIn(menuRef.current);
        },
      }}
      shouldShow={({ editor: instance, state }) => shouldShowTableBubble(instance, state.selection)}
      className="kb-bubble-menu flex max-w-[min(100vw-2rem,36rem)] flex-wrap items-center gap-0.5 rounded-lg border border-line-subtle bg-surface-raised p-1 shadow-overlay"
    >
      <Button
        variant="ghost"
        size="row"
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().addRowAfter().run()}
      >
        {labels.table.addRowBelow}
      </Button>
      <Button
        variant="ghost"
        size="row"
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      >
        {labels.table.addColumnRight}
      </Button>
      <Button
        variant="ghost"
        size="row"
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().deleteRow().run()}
      >
        {labels.table.deleteRow}
      </Button>
      <Button
        variant="ghost"
        size="row"
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().deleteColumn().run()}
      >
        {labels.table.deleteColumn}
      </Button>
      <Button
        variant="ghost"
        size="row"
        aria-pressed={inHeader}
        className={inHeader ? 'bg-overlay text-fg' : undefined}
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
      >
        {labels.table.headerRow}
      </Button>
      <Button
        variant="ghost"
        size="row"
        className="text-danger"
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        {labels.table.deleteTable}
      </Button>
    </BubbleMenu>
  );
}
