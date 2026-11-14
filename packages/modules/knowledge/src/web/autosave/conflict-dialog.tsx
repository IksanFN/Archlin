import { Button } from '@archlin/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@archlin/ui/components/dialog';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { useState } from 'react';

export interface ConflictDialogLabels {
  title: string;
  body: string;
  loadLatest: string;
  overwrite: string;
  changedAgain: string;
}

export function ConflictDialog({
  open,
  onOpenChange,
  changedAgain,
  onLoadLatest,
  onOverwrite,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changedAgain: boolean;
  onLoadLatest: () => Promise<void>;
  onOverwrite: () => Promise<void>;
  labels: ConflictDialogLabels;
}) {
  const [busy, setBusy] = useState<'load' | 'overwrite' | null>(null);

  async function run(kind: 'load' | 'overwrite', action: () => Promise<void>): Promise<void> {
    if (busy !== null) return;
    setBusy(kind);
    try {
      await action();
    } catch {
      // Stay open so the user can pick again; autosave keeps the conflict status.
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.body}</DialogDescription>
        </DialogHeader>
        {changedAgain ? <InlineStatus variant="attention">{labels.changedAgain}</InlineStatus> : null}
        <DialogFooter>
          <Button
            variant="outline"
            loading={busy === 'load'}
            disabled={busy === 'overwrite'}
            onClick={() => void run('load', onLoadLatest)}
          >
            {labels.loadLatest}
          </Button>
          <Button
            loading={busy === 'overwrite'}
            disabled={busy === 'load'}
            onClick={() => void run('overwrite', onOverwrite)}
          >
            {labels.overwrite}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
