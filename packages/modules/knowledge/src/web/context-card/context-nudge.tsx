import { Button } from '@archlin/ui/components/button';
import { InfoIcon } from '@phosphor-icons/react/ssr';

export interface ContextNudgeLabels {
  message: string;
  summary: string;
  whenToUse: string;
}

export function ContextNudge({
  onPick,
  labels,
}: {
  onPick(field: 'summary' | 'whenToUse'): void;
  labels: ContextNudgeLabels;
}) {
  return (
    <div
      role="status"
      className="enter-item mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-md border border-line-strong py-3.5 pr-3.5 pl-[18px]"
    >
      <InfoIcon aria-hidden="true" size={18} className="shrink-0 text-fg-muted" />
      <p className="min-w-0 flex-1 basis-48 text-small text-fg-secondary">{labels.message}</p>
      <Button variant="outline" className="h-8 px-3.5" onClick={() => onPick('summary')}>
        {labels.summary}
      </Button>
      <Button variant="outline" className="h-8 px-3.5" onClick={() => onPick('whenToUse')}>
        {labels.whenToUse}
      </Button>
    </div>
  );
}
