import { Button } from '@archlin/ui/components/button';
import { messages } from '~/i18n/id';

export function TrashBanner({ onRestore, busy }: { onRestore: () => void; busy: boolean }) {
  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-md bg-attention-soft px-4 py-3 text-small text-attention transition-[opacity,transform] duration-[200ms] ease-out starting:opacity-0 starting:-translate-y-1 motion-reduce:starting:translate-y-0 sm:flex-row sm:items-center sm:justify-between"
    >
      <p>{messages.page.trashBanner}</p>
      <Button size="row" loading={busy} onClick={onRestore}>
        {messages.page.restore}
      </Button>
    </div>
  );
}
