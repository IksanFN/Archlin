import type { NoteTypeSummary } from '@archlin/modules-knowledge/shared';
import { Button } from '@archlin/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@archlin/ui/components/dialog';
import { NativeSelect } from '@archlin/ui/components/native-select';
import { toast } from '@archlin/ui/components/sonner';
import { useState } from 'react';
import { useKnowledgeClient } from '../client';
import type { NoteTypeLabels } from './labels';

export function DeleteTypeDialog({
  type,
  others,
  open,
  onOpenChange,
  onDeleted,
  labels,
}: {
  type: NoteTypeSummary;
  others: readonly NoteTypeSummary[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onDeleted(): void;
  labels: NoteTypeLabels;
}) {
  const client = useKnowledgeClient();
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  // Pages in Trash still point at the type, so they are moved as well.
  const pages = type.pageCount + type.trashedPageCount;
  const copy = labels.remove;

  async function confirm(): Promise<void> {
    setBusy(true);
    try {
      await client.deleteNoteType({ id: type.id, reassignTo: pages > 0 ? target : null });
      toast(copy.done(type.name));
      onOpenChange(false);
      onDeleted();
    } catch {
      toast.error(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title(type.name)}</DialogTitle>
          {pages > 0 ? <DialogDescription>{copy.inUse(pages)}</DialogDescription> : null}
        </DialogHeader>
        {pages > 0 ? (
          <NativeSelect aria-label={copy.target} value={target} onChange={(event) => setTarget(event.target.value)}>
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {copy.cancel}
            </Button>
          </DialogClose>
          <Button variant="danger" loading={busy} disabled={pages > 0 && target === ''} onClick={() => void confirm()}>
            {pages > 0 ? copy.moveAndDelete : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
