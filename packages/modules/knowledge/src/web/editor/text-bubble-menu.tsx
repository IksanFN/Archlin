import { Button } from '@archlin/ui/components/button';
import { Kbd } from '@archlin/ui/components/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@archlin/ui/components/tooltip';
import { CodeIcon, LinkIcon, TextBIcon, TextItalicIcon, TextStrikethroughIcon, TextUnderlineIcon } from '@phosphor-icons/react/ssr';
import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { useEditorState } from '@tiptap/react';
import type { MouseEvent, ReactNode } from 'react';
import type { EditorLabels } from './labels';
import { LinkPopover } from './link-popover';

function modShortcut(key: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}

function keepSelection(event: MouseEvent): void {
  event.preventDefault();
}

function MarkButton({
  label,
  shortcut,
  pressed,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          className={pressed ? 'bg-overlay text-fg' : undefined}
          onMouseDown={keepSelection}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex items-center gap-1.5">
          {label}
          <Kbd>{shortcut}</Kbd>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export function TextBubbleMenu({ editor, labels }: { editor: Editor; labels: EditorLabels }) {
  const marks = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance.isActive('bold'),
      italic: instance.isActive('italic'),
      underline: instance.isActive('underline'),
      strike: instance.isActive('strike'),
      code: instance.isActive('code'),
      link: instance.isActive('link'),
    }),
  });

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="kb-text-bubble"
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: instance, state }) => {
        const { selection } = state;
        if (selection.empty) return false;
        if (instance.isActive('codeBlock')) return false;
        return true;
      }}
      className="kb-bubble-menu flex items-center gap-0.5 rounded-lg border border-line-subtle bg-surface-raised p-1 shadow-overlay"
    >
      <MarkButton
        label={labels.bold}
        shortcut={modShortcut('B')}
        pressed={marks.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <TextBIcon aria-hidden="true" size={16} />
      </MarkButton>
      <MarkButton
        label={labels.italic}
        shortcut={modShortcut('I')}
        pressed={marks.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <TextItalicIcon aria-hidden="true" size={16} />
      </MarkButton>
      <MarkButton
        label={labels.underline}
        shortcut={modShortcut('U')}
        pressed={marks.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <TextUnderlineIcon aria-hidden="true" size={16} />
      </MarkButton>
      <MarkButton
        label={labels.strike}
        shortcut={modShortcut('Shift+S')}
        pressed={marks.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <TextStrikethroughIcon aria-hidden="true" size={16} />
      </MarkButton>
      <MarkButton
        label={labels.code}
        shortcut={modShortcut('E')}
        pressed={marks.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <CodeIcon aria-hidden="true" size={16} />
      </MarkButton>
      <Tooltip>
        <LinkPopover editor={editor} labels={labels}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={labels.link}
              aria-pressed={marks.link}
              className={marks.link ? 'bg-overlay text-fg' : undefined}
              onMouseDown={keepSelection}
            >
              <LinkIcon aria-hidden="true" size={16} />
            </Button>
          </TooltipTrigger>
        </LinkPopover>
        <TooltipContent>
          <span className="flex items-center gap-1.5">
            {labels.link}
            <Kbd>{modShortcut('K')}</Kbd>
          </span>
        </TooltipContent>
      </Tooltip>
    </BubbleMenu>
  );
}
