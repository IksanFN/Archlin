import { Button } from '@archlin/ui/components/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@archlin/ui/components/dialog';
import { FormField } from '@archlin/ui/components/form-field';
import { Input } from '@archlin/ui/components/input';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { HistoryLabels } from './labels';

const NAME_MAX = 80;
const COUNTER_FROM = 70;

export function SaveVersionDialog({
  open,
  onOpenChange,
  onSave,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Resolves true once the version is stored, which closes the dialog.
  onSave: (label: string | null) => Promise<boolean>;
  labels: HistoryLabels;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      const trimmed = name.trim();
      if (await onSave(trimmed === '' ? null : trimmed)) {
        onOpenChange(false);
        setName('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent aria-describedby={undefined}>
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{labels.saveVersionTitle}</DialogTitle>
          </DialogHeader>
          <FormField label={labels.versionName} helper={name.length >= COUNTER_FROM ? labels.versionNameCount(name.length) : undefined}>
            {(control) => (
              <Input
                {...control}
                value={name}
                maxLength={NAME_MAX}
                placeholder={labels.versionNamePlaceholder}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={busy}>
                {labels.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              {labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
