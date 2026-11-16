import { diffVersions } from '@archlin/modules-knowledge/shared';
import type { FieldKey, PageView } from '@archlin/modules-knowledge/shared';
import { Button } from '@archlin/ui/components/button';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { SegmentedControl } from '@archlin/ui/components/segmented-control';
import { Skeleton } from '@archlin/ui/components/skeleton';
import { useMemo } from 'react';
import type { PageDraftState } from '../autosave/autosave-machine';
import type { EditorLabels } from '../editor/labels';
import { PageEditor } from '../editor/page-editor';
import type { PageEditorLinks } from '../links/page-editor-links';
import type { PanelLayout } from '../panel/panel-frame';
import { DiffView } from './diff-view';
import { fieldLabel, snapshotFromDetail, snapshotFromDraft } from './history-model';
import type { HistoryLabels } from './labels';
import type { VersionHistory } from './use-version-history';

const noop = (): void => undefined;

// Takes the reading column's place while the history panel is open: what the chosen version changed, or the version itself.
export function HistoryMain({
  history,
  page,
  draft,
  labels,
  editorLabels,
  links,
  formatTime,
  layout,
  trashed,
  onShowList,
  onClose,
}: {
  history: VersionHistory;
  page: PageView;
  draft: PageDraftState;
  labels: HistoryLabels;
  editorLabels: EditorLabels;
  links: PageEditorLinks;
  formatTime: (iso: string) => string;
  layout: PanelLayout;
  trashed: boolean;
  onShowList: () => void;
  onClose: () => void;
}) {
  const { detail } = history;
  const version = detail.status === 'ready' ? detail.version : null;
  const diff = useMemo(
    () => (version === null ? null : diffVersions(snapshotFromDetail(version), snapshotFromDraft(page, draft))),
    [version, page, draft],
  );

  // Below the docked width the panel is a sheet, so the list and the restore action live here, in the column.
  const sheetActions =
    layout === 'sheet' ? (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="row" onClick={onShowList}>
          {labels.title}
        </Button>
        <Button size="row" loading={history.restoring} disabled={history.selectedId === null || trashed} onClick={() => void history.restore()}>
          {labels.restore}
        </Button>
        <Button variant="ghost" size="row" onClick={onClose}>
          {labels.closePanel}
        </Button>
      </div>
    ) : null;

  if (history.selectedId === null) {
    return (
      <div className="grid gap-4">
        {sheetActions}
        <p className="text-small text-fg-muted">{labels.pick}</p>
      </div>
    );
  }
  if (detail.status === 'loading' || detail.status === 'idle') {
    return (
      <div className="grid gap-3" aria-hidden="true">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-5" />
        <Skeleton className="h-5 w-5/6" />
      </div>
    );
  }
  if (detail.status === 'error' || version === null || diff === null) {
    return (
      <div className="grid gap-3">
        <InlineStatus variant="danger">{labels.loadFailed}</InlineStatus>
        <div>
          <Button variant="outline" size="row" onClick={history.retryDetail}>
            {labels.retry}
          </Button>
        </div>
      </div>
    );
  }

  return (
    // Keyed by version so changing the selection fades the area in instead of swapping it hard.
    <div key={version.id} className="page-enter grid gap-5">
      {sheetActions}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-micro text-fg-muted">{labels.comparing(formatTime(version.createdAt))}</p>
        <SegmentedControl
          aria-label={labels.title}
          value={history.view}
          onValueChange={history.setView}
          options={[
            { value: 'changes', label: labels.changes },
            { value: 'preview', label: labels.preview },
          ]}
        />
      </div>
      <h2 className="text-h2 text-fg">{version.title === '' ? editorLabels.untitled : version.title}</h2>
      {history.view === 'changes' ? (
        <DiffView diff={diff} fieldLabel={(field: FieldKey) => fieldLabel(field, page.noteType.fieldSchema, labels)} labels={labels} />
      ) : (
        <PageEditor content={version.content} editable={false} labels={editorLabels} links={links} onChange={noop} />
      )}
    </div>
  );
}
