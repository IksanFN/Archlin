import { Button } from '@archlin/ui/components/button';
import { FormField } from '@archlin/ui/components/form-field';
import { Input } from '@archlin/ui/components/input';
import { InputOTP, InputOTPGroup, InputOTPSlot, REGEXP_ONLY_DIGITS } from '@archlin/ui/components/input-otp';
import { Label } from '@archlin/ui/components/label';
import { toast } from '@archlin/ui/components/sonner';
import { ArrowLeftIcon } from '@phosphor-icons/react/ssr';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AuthLayout } from '~/components/auth-layout';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { AppError } from '~/server/errors';
import { loginTotpFn } from '~/server/functions/auth';

const copy = messages.auth.totp;
const CODE_LENGTH = 6;

export const Route = createFileRoute('/login/totp')({
  head: () => ({ meta: [{ title: `${copy.title} · ${messages.appName}` }] }),
  component: TotpPage,
});

function TotpPage() {
  const navigate = useNavigate();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const otpLabelId = useId();

  const canSubmit = useRecovery ? recoveryCode.trim().length > 0 : code.length === CODE_LENGTH;

  async function handleFailure(failure: unknown): Promise<void> {
    if (failure instanceof AppError && failure.code === 'challenge_expired') {
      await navigate({ to: '/login', search: { alasan: 'verifikasi-habis' } });
      return;
    }
    if (failure instanceof AppError && failure.code === 'invalid_code') {
      setError(useRecovery ? copy.invalidRecoveryCode : copy.invalidCode);
      setCode('');
      return;
    }
    const presentation = messageForError(failure);
    if (presentation.kind === 'toast') toast.error(presentation.text);
    else if (presentation.kind === 'field') setError(messages.errors.invalidField);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current || !canSubmit) return;
    submitting.current = true;
    setPending(true);
    setError(undefined);
    try {
      await loginTotpFn({ data: useRecovery ? { recoveryCode: recoveryCode.trim() } : { code } });
      await navigate({ to: '/' });
    } catch (failure) {
      await handleFailure(failure);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function switchMode(): void {
    setUseRecovery((current) => !current);
    setError(undefined);
    setCode('');
    setRecoveryCode('');
  }

  return (
    <AuthLayout title={copy.title} description={copy.description}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
        {useRecovery ? (
          <FormField label={copy.recoveryLabel} error={error}>
            {(control) => (
              <Input
                {...control}
                size="lg"
                inputClassName="font-mono"
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                placeholder={copy.recoveryPlaceholder}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                autoFocus
              />
            )}
          </FormField>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor={otpLabelId} className="sr-only">
              {copy.codeLabel}
            </Label>
            <InputOTP
              id={otpLabelId}
              maxLength={CODE_LENGTH}
              value={code}
              onChange={setCode}
              pattern={REGEXP_ONLY_DIGITS}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              aria-invalid={error === undefined ? undefined : true}
              // Authenticator apps format the code as "123 456"; pasting it should still fill all six slots.
              pasteTransformer={(pasted) => pasted.replace(/\s+/g, '')}
            >
              <InputOTPGroup>
                {Array.from({ length: CODE_LENGTH }, (_, index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            {error === undefined ? null : (
              <p role="alert" className="text-micro text-danger">
                {error}
              </p>
            )}
          </div>
        )}
        <Button type="submit" size="auth" loading={pending} disabled={!canSubmit}>
          {copy.submit}
        </Button>
        <div className="flex items-center justify-between text-[13px]">
          <Link to="/login" className="inline-flex min-h-8 items-center gap-1.5 text-fg-muted hover:text-fg">
            <ArrowLeftIcon aria-hidden="true" size={14} />
            {copy.back}
          </Link>
          <button type="button" onClick={switchMode} className="inline-flex min-h-8 items-center text-fg-secondary hover:text-fg">
            {useRecovery ? copy.useApp : copy.useRecovery}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
