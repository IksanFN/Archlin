import { Button } from '@archlin/ui/components/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@archlin/ui/components/dialog';
import { toast } from '@archlin/ui/components/sonner';
import type { Viewer } from '@archlin/platform/contracts';
import { useRouter } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { PasswordField } from '~/components/password-field';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { formatDate } from '~/lib/format-time';
import { changePasswordFn } from '~/server/functions/account';
import { useReauth } from './reauth-dialog';
import { SettingsGroup, SettingsRow } from './settings-row';

const copy = messages.settings.password;

export function PasswordSection({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  return (
    <SettingsGroup label={copy.group}>
      <SettingsRow title={copy.title} description={copy.lastChanged(formatDate(new Date(viewer.passwordChangedAt), viewer.timezone))}>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="row">
              {copy.change}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <ChangePasswordForm onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </SettingsRow>
    </SettingsGroup>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const reauth = useReauth();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [repeatError, setRepeatError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    setPasswordError(undefined);
    if (password !== repeat) {
      setRepeatError(messages.password.mismatch);
      return;
    }
    setRepeatError(undefined);
    submitting.current = true;
    setPending(true);
    try {
      await reauth(async () => {
        await changePasswordFn({ data: { newPassword: password } });
        toast.success(copy.changed);
        onDone();
        await router.invalidate();
      });
    } catch (error) {
      const presentation = messageForError(error);
      if (presentation.kind === 'field') setPasswordError(presentation.fields.password ?? messages.errors.invalidField);
      else if (presentation.kind === 'toast') toast.error(presentation.text);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{copy.dialogTitle}</DialogTitle>
        <DialogDescription>{copy.dialogBody}</DialogDescription>
      </DialogHeader>
      <PasswordField label={copy.newPassword} value={password} onChange={setPassword} autoComplete="new-password" error={passwordError} size="default" meter autoFocus />
      <PasswordField label={copy.repeatPassword} value={repeat} onChange={setRepeat} autoComplete="new-password" error={repeatError} size="default" />
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{messages.common.cancel}</Button>
        </DialogClose>
        <Button type="submit" loading={pending}>
          {copy.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
