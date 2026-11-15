import { Button } from '@archlin/ui/components/button';

export interface DraftBannerLabels {
  message: (relative: string) => string;
  restore: string;
  discard: string;
}

export function DraftBanner({
  relativeTime,
  onRestore,
  onDiscard,
  labels,
}: {
  relativeTime: string;
  onRestore: () => void;
  onDiscard: () => void;
  labels: DraftBannerLabels;
}) {
  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-md bg-attention-soft px-4 py-3 text-small text-attention transition-[opacity,transform] duration-[200ms] ease-out starting:opacity-0 starting:-translate-y-1 motion-reduce:starting:translate-y-0 sm:flex-row sm:items-center sm:justify-between"
    >
      <p>{labels.message(relativeTime)}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="row" onClick={onRestore}>
          {labels.restore}
        </Button>
        <Button variant="outline" size="row" onClick={onDiscard}>
          {labels.discard}
        </Button>
      </div>
    </div>
  );
}
