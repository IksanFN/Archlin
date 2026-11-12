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
import { InputOTP, InputOTPGroup, InputOTPSlot, REGEXP_ONLY_DIGITS } from '@archlin/ui/components/input-otp';
import { Label } from '@archlin/ui/components/label';
import { toast } from '@archlin/ui/components/sonner';
import { createContext, use, useCallback, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { PasswordField } from '~/components/password-field';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { AppError } from '~/server/errors';
import { reauthFn } from '~/server/functions/account';

const copy = messages.settings.reauth;

type ReauthRunner = (action: () => Promise<void>) => Promise<void>;

const ReauthContext = createContext<ReauthRunner | null>(null);

function isReauthRequired(error: unknown): boolean {
  return error instanceof AppError && error.code === 'reauth_required';
}

// Runs a sensitive action; if the server asks for a fresh confirmation, asks the user once and retries one time.
// A cancelled confirmation drops the action silently, so success side effects belong inside the action itself.
export function useReauth(): ReauthRunner {
  const runner = use(ReauthContext);
  if (runner === null) throw new Error('useReauth needs a ReauthProvider above it');
  return runner;
}

export function ReauthProvider({ totpEnabled, children }: { totpEnabled: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);

  const request = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        pending.current = resolve;
        setOpen(true);
      }),
    [],
  );

  const finish = useCallback((confirmed: boolean) => {
    pending.current?.(confirmed);
    pending.current = null;
    setOpen(false);
  }, []);

  const run = useCallback<ReauthRunner>(
    async (action) => {
      try {
        await action();
      } catch (error) {
        if (!isReauthRequired(error)) throw error;
        if (!(await request())) return;
        await action();
      }
    },
    [request],
  );

  return (
    <ReauthContext value={run}>
      {children}
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : finish(false))}>
        <DialogContent>
          <ReauthForm totpEnabled={totpEnabled} onConfirmed={() => finish(true)} />
        </DialogContent>
      </Dialog>
    </ReauthContext>
  );
}

function ReauthForm({ totpEnabled, onConfirmed }: { totpEnabled: boolean; onConfirmed: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const codeId = useId();

  const ready = password.length > 0 && (!totpEnabled || code.length === 6);

  function handleFailure(error: unknown): void {
    if (error instanceof AppError && error.code === 'invalid_credentials') {
      setPasswordError(copy.wrongPassword);
    } else if (error instanceof AppError && error.code === 'invalid_code') {
      setCodeError(copy.wrongCode);
    } else {
      const presentation = messageForError(error);
      if (presentation.kind === 'toast') toast.error(presentation.text);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current || !ready) return;
    submitting.current = true;
    setPending(true);
    setPasswordError(undefined);
    setCodeError(undefined);
    try {
      await reauthFn({ data: totpEnabled ? { password, totpCode: code } : { password } });
      onConfirmed();
    } catch (error) {
      handleFailure(error);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.body}</DialogDescription>
      </DialogHeader>
      <PasswordField
        label={copy.password}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        error={passwordError}
        size="default"
        autoFocus
      />
      {totpEnabled ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={codeId}>{copy.code}</Label>
          <InputOTP
            id={codeId}
            maxLength={6}
            value={code}
            onChange={setCode}
            pattern={REGEXP_ONLY_DIGITS}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-invalid={codeError === undefined ? undefined : true}
            pasteTransformer={(pasted) => pasted.replace(/\s+/g, '')}
          >
            <InputOTPGroup>
              {Array.from({ length: 6 }, (_, index) => (
                <InputOTPSlot key={index} index={index} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {codeError === undefined ? null : (
            <p role="alert" className="text-micro text-danger">
              {codeError}
            </p>
          )}
        </div>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{messages.common.cancel}</Button>
        </DialogClose>
        <Button type="submit" loading={pending} disabled={!ready}>
          {copy.confirm}
        </Button>
      </DialogFooter>
    </form>
  );
}
