import type { NoteTypeSummary } from '@archlin/modules-knowledge/shared';
import { Badge } from '@archlin/ui/components/badge';
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
import { toast } from '@archlin/ui/components/sonner';
import { useEffect, useRef, useState } from 'react';
import { KnowledgeClientError, useKnowledgeClient } from '../client';
import type { NoteTypeLabels } from './labels';

export function ChangeTypeDialog({
  entityId,
  noteTypeId,
  open,
  onOpenChange,
  prepareTypeChange,
  onChanged,
  labels,
}: {
  entityId: string;
  noteTypeId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  // Saves pending edits and resolves to the saved version, or null while they cannot be saved.
  prepareTypeChange(): Promise<number | null>;
  onChanged(): void;
  labels: NoteTypeLabels;
}) {
  const client = useKnowledgeClient();
  const [types, setTypes] = useState<NoteTypeSummary[] | null>(null);
  const [chosen, setChosen] = useState(noteTypeId);
  const [busy, setBusy] = useState(false);
  const copy = labels.change;
  // The load effect must not restart each time the parent hands over a new callback.
  const closeRef = useRef(onOpenChange);
  useEffect(() => {
    closeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    client.listNoteTypes().then(
      (list) => {
        if (!cancelled) setTypes(list);
      },
      () => {
        if (cancelled) return;
        toast.error(copy.loadFailed);
        closeRef.current(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, client, copy.loadFailed]);

  async function confirm(): Promise<void> {
    setBusy(true);
    try {
      const baseVersion = await prepareTypeChange();
      if (baseVersion === null) {
        toast.error(copy.blocked);
        return;
      }
      await client.changeNoteType({ entityId, baseVersion, noteTypeId: chosen });
      onOpenChange(false);
      toast(copy.done);
      onChanged();
    } catch (error) {
      if (error instanceof KnowledgeClientError && error.code === 'page_conflict') {
        toast.error(copy.conflict);
        onChanged();
      } else {
        toast.error(copy.failed);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.note}</DialogDescription>
        </DialogHeader>
        <fieldset className="flex max-h-72 flex-col overflow-auto">
          <legend className="sr-only">{copy.title}</legend>
          {(types ?? []).map((type) => (
            <label
              key={type.id}
              className="flex h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-small transition-colors duration-[120ms] ease-out hover:bg-overlay has-[:checked]:bg-surface-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus"
            >
              <input
                type="radio"
                name="note-type"
                value={type.id}
                checked={chosen === type.id}
                onChange={() => setChosen(type.id)}
                className="sr-only"
              />
              <span className="flex size-5 items-center justify-center">{type.icon}</span>
              <span className="flex-1 truncate text-fg">{type.name}</span>
              {type.id === noteTypeId ? <Badge>{copy.current}</Badge> : null}
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {copy.cancel}
            </Button>
          </DialogClose>
          <Button loading={busy} disabled={chosen === noteTypeId || types === null} onClick={() => void confirm()}>
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
