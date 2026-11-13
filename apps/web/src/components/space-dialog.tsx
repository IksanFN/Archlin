import { Button } from '@archlin/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@archlin/ui/components/dialog';
import { EmojiField } from '@archlin/ui/components/emoji-field';
import { FormField } from '@archlin/ui/components/form-field';
import { Input } from '@archlin/ui/components/input';
import { toast } from '@archlin/ui/components/sonner';
import { isSingleEmoji, type SpaceSummary } from '@archlin/platform/contracts';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { createSpaceFn, updateSpaceFn } from '~/server/functions/spaces';

function SpaceDialogForm({
  mode,
  space,
  onOpenChange,
  onDone,
}: {
  mode: 'create' | 'rename';
  space?: SpaceSummary;
  onOpenChange: (open: boolean) => void;
  onDone?: (space: SpaceSummary) => void;
}) {
  const [name, setName] = useState(space?.name ?? '');
  const [icon, setIcon] = useState<string | null>(space?.icon ?? null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [invalidAttempt, setInvalidAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setError(messages.errors.invalidField);
      setInvalidAttempt((current) => current + 1);
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(undefined);
    try {
      const result =
        mode === 'create'
          ? await createSpaceFn({ data: { name: trimmed, icon } })
          : await updateSpaceFn({ data: { id: space?.id ?? '', name: trimmed, icon } });
      onDone?.(result);
      onOpenChange(false);
    } catch (err) {
      const presentation = messageForError(err);
      if (presentation.kind === 'field') {
        setError(presentation.fields.name ?? messages.errors.invalidField);
        setInvalidAttempt((current) => current + 1);
      } else if (presentation.kind === 'toast') {
        toast.error(presentation.text);
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{mode === 'create' ? messages.spaces.create : messages.spaces.rename}</DialogTitle>
      </DialogHeader>
      <FormField label={messages.spaces.name} error={error} invalidAttempt={invalidAttempt}>
        {(control) => (
          <Input
            {...control}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={messages.spaces.namePlaceholder}
            maxLength={80}
            autoFocus
          />
        )}
      </FormField>
      <EmojiField value={icon} onChange={setIcon} isValid={isSingleEmoji} labels={messages.icon} />
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{messages.common.cancel}</Button>
        </DialogClose>
        <Button type="submit" loading={pending}>
          {mode === 'create' ? messages.spaces.create : messages.tree.rename}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SpaceDialog({
  open,
  onOpenChange,
  mode,
  space,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'rename';
  space?: SpaceSummary;
  onDone?: (space: SpaceSummary) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <SpaceDialogForm
            key={space?.id ?? mode}
            mode={mode}
            {...(space === undefined ? {} : { space })}
            onOpenChange={onOpenChange}
            {...(onDone === undefined ? {} : { onDone })}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
