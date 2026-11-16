import { AttachmentNode, Callout, contentExtensions, Mention, WikiLink } from '@archlin/modules-knowledge/shared';
import type { Extensions } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Placeholder } from '@tiptap/extensions';
import { ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';
import { createElement, type ComponentType } from 'react';
import { BlockCommands } from './block-commands';
import { BlockHandleExtension } from './block-handle';
import { CalloutView } from './callout-view';
import { CodeBlockView } from './code-block-view';
import { FindReplace } from './find-replace';
import type { EditorLabels } from './labels';
import { AttachmentCard } from '../attachments/attachment-view';
import { AttachmentUpload } from '../attachments/upload-plugin';
import type { AttachmentStore } from '../attachments/attachment-store';
import type { PageEditorAttachments } from '../attachments/page-editor-attachments';
import { LinkNodeView } from '../links/wiki-link-view';
import { LinkSuggestions } from '../links/link-suggestion';
import type { PageEditorLinks } from '../links/page-editor-links';
import { MarkdownPaste } from './markdown-paste';
import { SlashCommand } from './slash-command';

const lowlight = createLowlight(common);

function bindLabels(
  View: ComponentType<ReactNodeViewProps & { labels: EditorLabels }>,
  labels: EditorLabels,
): ComponentType<ReactNodeViewProps> {
  function Bound(props: ReactNodeViewProps) {
    return createElement(View, { ...props, labels });
  }
  Bound.displayName = View.displayName ?? View.name;
  return Bound;
}

// Editors that are not a page (the note type template) pass no links and keep plain link nodes without a picker.
function bindAttachmentCard(store: AttachmentStore, labels: EditorLabels): ComponentType<ReactNodeViewProps> {
  function Bound(props: ReactNodeViewProps) {
    return createElement(AttachmentCard, { ...props, store, labels: labels.attachments });
  }
  Bound.displayName = 'AttachmentCard';
  return Bound;
}

export interface EditorExtensionOptions {
  links?: PageEditorLinks | undefined;
  // Without it (the note type template) the editor takes no files.
  attachments?: (PageEditorAttachments & { announce(message: string): void; notify(message: string): void }) | undefined;
}

function linkNode(kind: 'wikiLink' | 'mention', labels: EditorLabels, links: PageEditorLinks) {
  return (kind === 'wikiLink' ? WikiLink : Mention).extend({
    addNodeView: () => (props) => new LinkNodeView(props.node, { kind, editor: props.editor, links, labels, getPos: () => props.getPos() }),
  });
}

export function editorExtensions(labels: EditorLabels, options: EditorExtensionOptions): Extensions {
  return [
    ...contentExtensions().map((extension) => {
      if (extension.name === 'codeBlock') {
        return CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }).extend({
          addNodeView: () => ReactNodeViewRenderer(bindLabels(CodeBlockView, labels)),
        });
      }
      if (extension.name === 'callout') {
        return Callout.extend({
          addNodeView: () => ReactNodeViewRenderer(bindLabels(CalloutView, labels)),
        });
      }
      if (options.attachments !== undefined && extension.name === 'attachment') {
        const { store } = options.attachments;
        return AttachmentNode.extend({
          addNodeView: () => ReactNodeViewRenderer(bindAttachmentCard(store, labels)),
        });
      }
      if (options.links !== undefined && (extension.name === 'wikiLink' || extension.name === 'mention')) {
        return linkNode(extension.name, labels, options.links);
      }
      return extension;
    }),
    Placeholder.configure({
      showOnlyCurrent: true,
      placeholder: ({ node }) => (node.type.name === 'heading' ? labels.headingPlaceholder : labels.placeholder),
    }),
    SlashCommand.configure({ labels }),
    ...(options.links === undefined ? [] : [LinkSuggestions.configure({ links: options.links, labels })]),
    ...(options.attachments === undefined ? [] : [AttachmentUpload.configure({ ...options.attachments, labels })]),
    BlockCommands,
    BlockHandleExtension,
    MarkdownPaste,
    FindReplace,
  ];
}
