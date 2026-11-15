import { Button } from '@archlin/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@archlin/ui/components/dialog';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { toast } from '@archlin/ui/components/sonner';
import { useLeaving } from '@archlin/ui/lib/use-leaving';
import type { SpaceSummary } from '@archlin/platform/contracts';
import { FolderSimpleIcon } from '@phosphor-icons/react/ssr';
import { useCallback, useState } from 'react';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { notifyTreeMutation } from '~/lib/tree-sync';
import { useAsyncData } from '~/lib/use-async-data';
import { listSpacesFn, unarchiveSpaceFn } from '~/server/functions/spaces';

function ArchivedList({ onRestored }: { onRestored: () => void }) {
  const load = useCallback(async () => {
    const all = await listSpacesFn({ data: { includeArchived: true } });
    return all.filter((space) => space.archivedAt !== null);
  }, []);
  const { state, reload } = useAsyncData(load);
  const leaving = useLeaving<string>();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  async function restore(space: SpaceSummary): Promise<void> {
    await leaving.leave(space.id);
    setHiddenIds((current) => {
      const next = new Set(current);
      next.add(space.id);
      return next;
    });
    try {
      await unarchiveSpaceFn({ data: { id: space.id } });
      notifyTreeMutation();
      onRestored();
      reload();
    } catch (error) {
      setHiddenIds((current) => {
        const next = new Set(current);
        next.delete(space.id);
        return next;
      });
      const presentation = messageForError(error);
      if (presentation.kind === 'toast') toast.error(presentation.text);
      reload();
    }
  }

  if (state.status === 'loading') return null;
  if (state.status === 'error') {
    return (
      <div className="flex flex-col gap-2">
        <InlineStatus variant="danger">{messages.settings.loadFailed(messages.spaces.archived)}</InlineStatus>
        <Button variant="secondary" size="row" onClick={reload}>
          {messages.common.retry}
        </Button>
      </div>
    );
  }
  const rows = state.data.filter((space) => !hiddenIds.has(space.id));
  if (rows.length === 0) {
    return <p className="text-small text-fg-muted">{messages.spaces.noArchived}</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((space) => (
        <li
          key={space.id}
          data-leaving={leaving.isLeaving(space.id) ? 'true' : undefined}
          className="flex h-11 items-center gap-2 rounded-md px-2"
        >
          <span className="flex size-[18px] items-center justify-center text-fg-muted">
            {space.icon ?? <FolderSimpleIcon aria-hidden="true" size={18} />}
          </span>
          <span className="min-w-0 flex-1 truncate text-ui">{space.name}</span>
          <Button variant="secondary" size="row" onClick={() => void restore(space)}>
            {messages.spaces.unarchive}
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function ArchivedSpacesDialog({
  open,
  onOpenChange,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{messages.spaces.archived}</DialogTitle>
        </DialogHeader>
        {open ? <ArchivedList onRestored={onRestored} /> : null}
      </DialogContent>
    </Dialog>
  );
}
