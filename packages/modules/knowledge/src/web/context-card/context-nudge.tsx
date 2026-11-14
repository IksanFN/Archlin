import { Button } from '@archlin/ui/components/button';
import { InlineStatus } from '@archlin/ui/components/inline-status';

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
    <div className="enter-item mt-3 flex flex-col gap-2">
      <InlineStatus variant="info">{labels.message}</InlineStatus>
      <div className="flex gap-1">
        <Button variant="ghost" onClick={() => onPick('summary')}>
          {labels.summary}
        </Button>
        <Button variant="ghost" onClick={() => onPick('whenToUse')}>
          {labels.whenToUse}
        </Button>
      </div>
    </div>
  );
}
