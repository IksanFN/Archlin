import { autoUpdate, computePosition, flip, shift } from '@floating-ui/dom';
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import { Suggestion } from '@tiptap/suggestion';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { LabelsWithLinks } from './labels';
import { LinkPicker } from './link-picker';
import type { LinkPickerHandle, LinkPickerProps, PickerRow } from './link-picker';
import type { LinkNodeKind } from './link-presentation';
import type { PageEditorLinks } from './page-editor-links';
import type { PickerItem } from './picker-items';

export interface LinkSuggestionOptions {
  links: PageEditorLinks;
  labels: LabelsWithLinks;
}

const SUGGESTION_DEBOUNCE_MS = 150;

function createPickerRenderer(trigger: LinkNodeKind, labels: LabelsWithLinks) {
  let component: ReactRenderer<LinkPickerHandle, LinkPickerProps> | null = null;
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

  const propsFor = (props: SuggestionProps<PickerRow, PickerItem>): LinkPickerProps => ({
    rows: props.items,
    loading: props.loading === true,
    query: props.query,
    trigger,
    command: props.command,
    labels: labels.links,
    editorDom: props.editor.view.dom,
  });

  return {
    onStart(props: SuggestionProps<PickerRow, PickerItem>) {
      getRect = () => props.clientRect?.() ?? null;
      component = new ReactRenderer(LinkPicker, { editor: props.editor, props: propsFor(props) });
      const element = component.element;
      element.style.position = 'fixed';
      element.style.zIndex = '50';
      element.style.visibility = 'hidden';
      document.body.appendChild(element);
      const reference = { getBoundingClientRect: () => getRect() ?? new DOMRect() };
      cleanup = autoUpdate(reference, element, position);
    },
    onUpdate(props: SuggestionProps<PickerRow, PickerItem>) {
      getRect = () => props.clientRect?.() ?? null;
      component?.updateProps(propsFor(props));
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

// `[[` and `@` share one picker; only the node they insert and the characters allowed before them differ.
export const LinkSuggestions = Extension.create<LinkSuggestionOptions>({
  name: 'linkSuggestions',

  addOptions() {
    return { links: undefined as unknown as PageEditorLinks, labels: undefined as unknown as LabelsWithLinks };
  },

  addProseMirrorPlugins() {
    const { links, labels } = this.options;

    const suggestion = (nodeName: LinkNodeKind, key: string, char: string, allowedPrefixes: string[] | null) =>
      Suggestion<PickerRow, PickerItem>({
        pluginKey: new PluginKey(key),
        editor: this.editor,
        char,
        allowSpaces: nodeName === 'wikiLink',
        allowedPrefixes,
        debounce: SUGGESTION_DEBOUNCE_MS,
        items: async ({ query, signal }) => {
          try {
            return await links.client.suggestPages({ q: query.trim(), spaceId: links.spaceId, excludeId: links.entityId });
          } catch {
            return signal.aborted ? [] : [{ failed: true }];
          }
        },
        command: ({ editor, range, props }) => {
          if (props.kind === 'create') {
            editor.chain().focus().insertContentAt(range, { type: nodeName, attrs: { entityId: null, title: props.title } }).run();
            return;
          }
          const { entityId, title, icon, spaceSlug } = props.suggestion;
          // Seeded so the link shows its page address before the first save makes the server describe it.
          links.store.set({
            key: entityId,
            kind: nodeName === 'mention' ? 'mention' : 'wikilink',
            targetTitle: title,
            target: { id: entityId, title, icon, spaceSlug, trashed: false },
            ambiguous: false,
          });
          editor.chain().focus().insertContentAt(range, { type: nodeName, attrs: { entityId, title } }).run();
        },
        allow: ({ editor }) => editor.isEditable && !editor.isActive('codeBlock'),
        render: () => createPickerRenderer(nodeName, labels),
      });

    return [suggestion('wikiLink', 'kbWikiLinkSuggestion', '[[', null), suggestion('mention', 'kbMentionSuggestion', '@', [' ', '('])];
  },
});
