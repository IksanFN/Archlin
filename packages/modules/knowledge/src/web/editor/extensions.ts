import { Callout, contentExtensions } from '@archlin/modules-knowledge/shared';
import type { Extensions } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Placeholder } from '@tiptap/extensions';
import { ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';
import { createElement, type ComponentType } from 'react';
import { CalloutView } from './callout-view';
import { CodeBlockView } from './code-block-view';
import type { EditorLabels } from './labels';

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

export function editorExtensions(labels: EditorLabels): Extensions {
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
      return extension;
    }),
    Placeholder.configure({
      showOnlyCurrent: true,
      placeholder: ({ node }) => (node.type.name === 'heading' ? labels.headingPlaceholder : labels.placeholder),
    }),
  ];
}
