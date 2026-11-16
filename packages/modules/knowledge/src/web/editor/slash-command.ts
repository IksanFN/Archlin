import { autoUpdate, computePosition, flip, shift } from '@floating-ui/dom';
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import { Suggestion } from '@tiptap/suggestion';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { EditorLabels } from './labels';
import { SlashMenu } from './slash-menu';
import type { SlashMenuHandle, SlashMenuProps } from './slash-menu';
import { filterSlashItems, slashItems } from './slash-items';
import type { SlashItem } from './slash-items';

export interface SlashCommandOptions {
  labels: EditorLabels;
}

function createSlashRenderer(labels: EditorLabels) {
  let component: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null;
  let cleanup: (() => void) | undefined;
  let getRect: () => DOMRect | null = () => null;

  function position(): void {
    const element = component?.element;
    if (element === undefined) return;
    const reference = { getBoundingClientRect: () => getRect() ?? new DOMRect() };
    void computePosition(reference, element, {
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      Object.assign(element.style, { position: 'fixed', left: `${x}px`, top: `${y}px`, visibility: 'visible' });
    });
  }

  return {
    onStart(props: SuggestionProps<SlashItem, SlashItem>) {
      getRect = () => props.clientRect?.() ?? null;
      component = new ReactRenderer(SlashMenu, {
        editor: props.editor,
        props: { items: props.items, command: props.command, labels },
      });
      const element = component.element;
      element.style.position = 'fixed';
      element.style.zIndex = '50';
      element.style.visibility = 'hidden';
      document.body.appendChild(element);
      const reference = { getBoundingClientRect: () => getRect() ?? new DOMRect() };
      cleanup = autoUpdate(reference, element, position);
    },
    onUpdate(props: SuggestionProps<SlashItem, SlashItem>) {
      getRect = () => props.clientRect?.() ?? null;
      component?.updateProps({ items: props.items, command: props.command, labels });
    },
    onKeyDown(props: SuggestionKeyDownProps) {
      if (props.event.key === 'Escape') return true;
      return component?.ref?.onKeyDown(props) ?? false;
    },
    onExit() {
      cleanup?.();
      cleanup = undefined;
      component?.element.remove();
      component?.destroy();
      component = null;
    },
  };
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return { labels: {} as EditorLabels };
  },

  addProseMirrorPlugins() {
    const labels = this.options.labels;
    return [
      Suggestion<SlashItem, SlashItem>({
        pluginKey: new PluginKey('slashCommand'),
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        placement: 'bottom-start',
        // Editors that cannot upload (the note type template) never list the attachment item.
        items: ({ query, editor }) =>
          filterSlashItems(slashItems(labels), query).filter(
            (item) => item.id !== 'attachment' || editor.extensionManager.extensions.some((extension) => extension.name === 'attachmentUpload'),
          ),
        command: ({ editor, range, props }) => {
          props.run(editor, range);
        },
        allow: ({ editor }) => editor.isEditable && !editor.isActive('codeBlock'),
        render: () => createSlashRenderer(labels),
      }),
    ];
  },
});
