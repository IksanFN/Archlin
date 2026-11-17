import type { Icon } from '@phosphor-icons/react';
import {
  CaretCircleRightIcon,
  CheckCircleIcon,
  CheckSquareIcon,
  CodeIcon,
  ImageIcon,
  InfoIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  MinusIcon,
  PaperclipIcon,
  QuotesIcon,
  TableIcon,
  TextAaIcon,
  TextHOneIcon,
  TextHThreeIcon,
  TextHTwoIcon,
  WarningIcon,
  WarningOctagonIcon,
} from '@phosphor-icons/react/ssr';
import type { Editor, Range } from '@tiptap/core';
import type { EditorLabels } from './labels';

export const OPEN_IMAGE_DIALOG = 'kb-open-image';
export const OPEN_FILE_PICKER = 'kb-open-file-picker';

export interface SlashItem {
  id: string;
  label: string;
  keywords: readonly string[];
  icon: Icon;
  run(editor: Editor, range: Range): void;
}

function afterSlash(editor: Editor, range: Range) {
  return editor.chain().focus().deleteRange(range);
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export function filterSlashItems(items: readonly SlashItem[], query: string): SlashItem[] {
  const needle = fold(query);
  if (needle.length === 0) return [...items];

  const prefix: SlashItem[] = [];
  const contains: SlashItem[] = [];
  const keyword: SlashItem[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (fold(item.label).startsWith(needle)) {
      prefix.push(item);
      seen.add(item.id);
    }
  }
  for (const item of items) {
    if (seen.has(item.id)) continue;
    if (fold(item.label).includes(needle)) {
      contains.push(item);
      seen.add(item.id);
    }
  }
  for (const item of items) {
    if (seen.has(item.id)) continue;
    if (item.keywords.some((word) => fold(word).startsWith(needle))) {
      keyword.push(item);
    }
  }
  return [...prefix, ...contains, ...keyword];
}

export function slashItems(labels: EditorLabels): SlashItem[] {
  const slash = labels.slash;
  return [
    {
      id: 'text',
      label: slash.text,
      keywords: ['text', 'paragraph'],
      icon: TextAaIcon,
      run: (editor, range) => {
        afterSlash(editor, range).setParagraph().run();
      },
    },
    {
      id: 'heading1',
      label: slash.heading1,
      keywords: ['h1', 'heading'],
      icon: TextHOneIcon,
      run: (editor, range) => {
        afterSlash(editor, range).setHeading({ level: 1 }).run();
      },
    },
    {
      id: 'heading2',
      label: slash.heading2,
      keywords: ['h2', 'heading'],
      icon: TextHTwoIcon,
      run: (editor, range) => {
        afterSlash(editor, range).setHeading({ level: 2 }).run();
      },
    },
    {
      id: 'heading3',
      label: slash.heading3,
      keywords: ['h3', 'heading'],
      icon: TextHThreeIcon,
      run: (editor, range) => {
        afterSlash(editor, range).setHeading({ level: 3 }).run();
      },
    },
    {
      id: 'bulletList',
      label: slash.bulletList,
      keywords: ['list', 'bullet'],
      icon: ListBulletsIcon,
      run: (editor, range) => {
        afterSlash(editor, range).toggleBulletList().run();
      },
    },
    {
      id: 'orderedList',
      label: slash.orderedList,
      keywords: ['list', 'numbered', 'ol'],
      icon: ListNumbersIcon,
      run: (editor, range) => {
        afterSlash(editor, range).toggleOrderedList().run();
      },
    },
    {
      id: 'taskList',
      label: slash.taskList,
      keywords: ['todo', 'checklist'],
      icon: CheckSquareIcon,
      run: (editor, range) => {
        afterSlash(editor, range).toggleTaskList().run();
      },
    },
    {
      id: 'quote',
      label: slash.quote,
      keywords: ['quote'],
      icon: QuotesIcon,
      run: (editor, range) => {
        afterSlash(editor, range).toggleBlockquote().run();
      },
    },
    {
      id: 'codeBlock',
      label: slash.codeBlock,
      keywords: ['code'],
      icon: CodeIcon,
      run: (editor, range) => {
        afterSlash(editor, range).toggleCodeBlock().run();
      },
    },
    {
      id: 'calloutInfo',
      label: slash.calloutInfo,
      keywords: ['note', 'callout', 'info'],
      icon: InfoIcon,
      run: (editor, range) => {
        afterSlash(editor, range).wrapIn('callout', { variant: 'info' }).run();
      },
    },
    {
      id: 'calloutWarning',
      label: slash.calloutWarning,
      keywords: ['warning', 'callout', 'note'],
      icon: WarningIcon,
      run: (editor, range) => {
        afterSlash(editor, range).wrapIn('callout', { variant: 'warning' }).run();
      },
    },
    {
      id: 'calloutDanger',
      label: slash.calloutDanger,
      keywords: ['danger', 'callout'],
      icon: WarningOctagonIcon,
      run: (editor, range) => {
        afterSlash(editor, range).wrapIn('callout', { variant: 'danger' }).run();
      },
    },
    {
      id: 'calloutSuccess',
      label: slash.calloutSuccess,
      keywords: ['success', 'callout', 'note'],
      icon: CheckCircleIcon,
      run: (editor, range) => {
        afterSlash(editor, range).wrapIn('callout', { variant: 'success' }).run();
      },
    },
    {
      id: 'details',
      label: slash.details,
      keywords: ['toggle'],
      icon: CaretCircleRightIcon,
      run: (editor, range) => {
        afterSlash(editor, range).setDetails().run();
      },
    },
    {
      id: 'table',
      label: slash.table,
      keywords: ['table'],
      icon: TableIcon,
      run: (editor, range) => {
        afterSlash(editor, range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      },
    },
    {
      id: 'divider',
      label: slash.divider,
      keywords: ['hr', 'divider'],
      icon: MinusIcon,
      run: (editor, range) => {
        afterSlash(editor, range).setHorizontalRule().run();
      },
    },
    {
      id: 'image',
      label: slash.image,
      keywords: ['image'],
      icon: ImageIcon,
      run: (editor, range) => {
        afterSlash(editor, range).run();
        editor.view.dom.dispatchEvent(new CustomEvent(OPEN_IMAGE_DIALOG, { bubbles: true }));
      },
    },
    {
      id: 'attachment',
      label: slash.attachment,
      keywords: ['file', 'berkas', 'pdf', 'docx', 'unggah', 'upload'],
      icon: PaperclipIcon,
      run: (editor, range) => {
        afterSlash(editor, range).run();
        editor.view.dom.dispatchEvent(new CustomEvent(OPEN_FILE_PICKER, { bubbles: true }));
      },
    },
  ];
}
