import type { FieldKey, VersionDiff } from '@archlin/modules-knowledge/shared';
import { cn } from '@archlin/ui/lib/utils';
import type { HistoryLabels } from './labels';

function Pill({ tone, children }: { tone: 'added' | 'removed' | 'field'; children: string }) {
  return (
    <span
      className={cn(
        'rounded-pill px-2.5 py-1 font-mono text-micro',
        tone === 'added' && 'bg-success-soft text-success',
        tone === 'removed' && 'bg-danger-soft text-danger',
        tone === 'field' && 'bg-overlay text-fg-secondary',
      )}
    >
      {children}
    </span>
  );
}

export function DiffView({
  diff,
  fieldLabel,
  labels,
}: {
  diff: VersionDiff;
  fieldLabel: (field: FieldKey) => string;
  labels: HistoryLabels;
}) {
  const identical = diff.added === 0 && diff.removed === 0 && diff.fields.length === 0;
  if (identical) return <p className="text-small text-fg-muted">{labels.identical}</p>;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap gap-2">
        {diff.added > 0 ? <Pill tone="added">{labels.added(diff.added)}</Pill> : null}
        {diff.removed > 0 ? <Pill tone="removed">{labels.removed(diff.removed)}</Pill> : null}
        {diff.fields.map((change) => (
          <Pill key={change.field} tone="field">
            {labels.fieldChanged(fieldLabel(change.field))}
          </Pill>
        ))}
      </div>
      {diff.fields.length === 0 ? null : (
        <div className="grid gap-4 rounded-md bg-surface px-3.5 py-3">
          {diff.fields.map((change) => (
            <div key={change.field} className="grid gap-1">
              <span className="font-mono text-micro uppercase text-fg-muted">{fieldLabel(change.field)}</span>
              <p className="text-small">
                <del className="text-danger">
                  <span className="sr-only">{labels.srRemoved} </span>
                  {change.before === '' ? labels.emptyValue : change.before}
                </del>
                <span aria-hidden="true" className="px-1.5 text-fg-muted">
                  →
                </span>
                <ins className="text-success no-underline">
                  <span className="sr-only">{labels.srAdded} </span>
                  {change.after === '' ? labels.emptyValue : change.after}
                </ins>
              </p>
            </div>
          ))}
        </div>
      )}
      {diff.lines.length === 0 ? null : (
        <div className="grid text-body">
          {diff.lines.map((line, index) =>
            line.kind === 'skipped' ? (
              <p key={index} className="py-1.5 text-center font-mono text-micro text-fg-muted">
                {labels.skipped(line.count)}
              </p>
            ) : (
              <p
                key={index}
                className={cn(
                  'grid grid-cols-[10px_1fr] gap-3 rounded-xs px-2 py-1 break-words',
                  line.kind === 'added' && 'bg-success-soft text-fg',
                  line.kind === 'removed' && 'bg-danger-soft text-fg',
                  line.kind === 'same' && 'text-fg-muted',
                )}
              >
                <span aria-hidden="true" className="font-mono text-micro leading-[1.9] text-fg-muted">
                  {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}
                </span>
                <span>
                  {line.kind === 'same' ? null : <span className="sr-only">{line.kind === 'added' ? labels.srAdded : labels.srRemoved} </span>}
                  {line.text === '' ? ' ' : line.text}
                </span>
              </p>
            ),
          )}
        </div>
      )}
    </div>
  );
}
