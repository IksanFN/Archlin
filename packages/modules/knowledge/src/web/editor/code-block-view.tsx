import { CopyButton } from '@archlin/ui/components/copy-button';
import { NativeSelect } from '@archlin/ui/components/native-select';
import type { NodeViewProps } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import { common } from 'lowlight';
import type { EditorLabels } from './labels';

const codeLanguages = Object.keys(common).sort((a, b) => a.localeCompare(b));

export function CodeBlockView({ node, updateAttributes, editor, labels }: NodeViewProps & { labels: EditorLabels }) {
  const language = typeof node.attrs.language === 'string' ? node.attrs.language : '';
  const editable = editor.isEditable;

  return (
    <NodeViewWrapper className="kb-code-block overflow-hidden rounded-lg border border-line-subtle bg-surface">
      <div className="flex h-10 items-center justify-between gap-2 px-2" contentEditable={false}>
        <NativeSelect
          aria-label={labels.plainText}
          value={language}
          disabled={!editable}
          wrapperClassName="h-8 w-[min(100%,11rem)] border-0 bg-transparent"
          className="h-8 pl-2 pr-7 font-mono text-micro"
          onChange={(event) => {
            const next = event.target.value;
            updateAttributes({ language: next === '' ? null : next });
          }}
        >
          <option value="">{labels.plainText}</option>
          {codeLanguages.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </NativeSelect>
        <CopyButton
          value={node.textContent}
          labels={{ copy: labels.copy, copied: labels.copied, failed: labels.copyFailed }}
          size="row"
        />
      </div>
      <pre className="kb-code-block-body m-0 overflow-x-auto px-4 py-3">
        <NodeViewContent />
      </pre>
    </NodeViewWrapper>
  );
}
