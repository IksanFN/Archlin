import { attachmentUrl } from '@archlin/modules-knowledge/shared';
import type { AttachmentView } from '@archlin/modules-knowledge/shared';
import { Button } from '@archlin/ui/components/button';
import { ArrowSquareOutIcon, DownloadSimpleIcon } from '@phosphor-icons/react/ssr';
import type { NodeViewProps } from '@tiptap/core';
import { NodeViewWrapper } from '@tiptap/react';
import { createElement, useSyncExternalStore } from 'react';
import type { AttachmentStore } from './attachment-store';
import { attachmentIcon, canOpenInline, formatBytes, statusTone } from './attachment-labels';
import type { AttachmentLabels } from './labels';

// The icon depends on the file type, so it is built with createElement rather than as a component chosen during render.
export function AttachmentIcon({ view }: { view: Pick<AttachmentView, 'kind' | 'mime'> }) {
  return createElement(attachmentIcon(view), { 'aria-hidden': true, size: 20, className: 'shrink-0 text-fg-muted' });
}

export const TONE_CLASS = { muted: 'text-fg-muted', attention: 'text-attention', danger: 'text-danger' } as const;

export function AttachmentActions({ view, labels }: { view: AttachmentView; labels: AttachmentLabels }) {
  return (
    <>
      {canOpenInline(view) ? (
        <Button asChild variant="ghost" size="row">
          <a href={attachmentUrl(view.id)} target="_blank" rel="noopener noreferrer">
            <ArrowSquareOutIcon aria-hidden="true" size={16} />
            {labels.open}
          </a>
        </Button>
      ) : null}
      <Button asChild variant="ghost" size="row">
        <a href={`${attachmentUrl(view.id)}?download=1`}>
          <DownloadSimpleIcon aria-hidden="true" size={16} />
          {labels.download}
        </a>
      </Button>
    </>
  );
}

export function AttachmentCard({
  node,
  store,
  labels,
}: NodeViewProps & { store: AttachmentStore; labels: AttachmentLabels }) {
  const id = typeof node.attrs.attachmentId === 'string' ? node.attrs.attachmentId : null;
  const view = useSyncExternalStore(
    store.subscribe,
    () => (id === null ? undefined : store.get(id)),
    () => undefined,
  );

  return (
    <NodeViewWrapper
      data-attachment=""
      data-attachment-id={id ?? ''}
      contentEditable={false}
      className="kb-attachment-card mt-3 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface px-3.5 py-3"
    >
      {view === undefined ? (
        <p className="text-small text-fg-muted">{labels.missing}</p>
      ) : (
        <>
          <AttachmentIcon view={view} />
          <div className="min-w-0 flex-1 basis-40">
            <p className="truncate text-small font-medium text-fg" title={view.filename}>
              {view.filename}
            </p>
            <p className="font-mono text-[12px] leading-5 text-fg-muted">
              {formatBytes(view.size)}
              {' · '}
              {view.trashed ? (
                <span className="text-attention">{labels.inTrash}</span>
              ) : (
                <span className={TONE_CLASS[statusTone(view.extraction)]}>{labels.status[view.extraction]}</span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <AttachmentActions view={view} labels={labels} />
          </div>
        </>
      )}
    </NodeViewWrapper>
  );
}
