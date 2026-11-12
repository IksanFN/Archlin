import { Button } from '@archlin/ui/components/button';
import { FormField } from '@archlin/ui/components/form-field';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { Input } from '@archlin/ui/components/input';
import { toast } from '@archlin/ui/components/sonner';
import { EnvelopeSimpleIcon } from '@phosphor-icons/react/ssr';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AuthLayout } from '~/components/auth-layout';
import { PasswordField } from '~/components/password-field';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { AppError } from '~/server/errors';
import { loginFn } from '~/server/functions/auth';

const copy = messages.auth.login;

export const Route = createFileRoute('/login/')({ component: LoginPage });

type Failure = { variant: 'danger' | 'attention'; text: string } | null;

function LoginPage() {
  const { alasan } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<Failure>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  function handleFailure(error: unknown): void {
    if (error instanceof AppError && error.code === 'invalid_credentials') {
      setFailure({ variant: 'danger', text: copy.invalidCredentials });
      return;
    }
    const presentation = messageForError(error);
    if (error instanceof AppError && error.code === 'too_many_attempts') {
      setFailure({ variant: 'attention', text: presentation.kind === 'toast' ? presentation.text : messages.errors.tooManyAttempts(15) });
    } else if (presentation.kind === 'toast') {
      toast.error(presentation.text);
    } else if (presentation.kind === 'field') {
      toast.error(messages.errors.invalidField);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setFailure(null);
    try {
      const outcome = await loginFn({ data: { email, password } });
      await navigate({ to: outcome.status === 'totp_required' ? '/login/totp' : '/' });
    } catch (error) {
      handleFailure(error);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <AuthLayout title={copy.title} description={copy.description}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
        {failure === null ? null : <InlineStatus variant={failure.variant}>{failure.text}</InlineStatus>}
        {alasan === 'sudah-disiapkan' ? <InlineStatus variant="info">{copy.alreadySetUp}</InlineStatus> : null}
        {alasan === 'verifikasi-habis' ? <InlineStatus variant="info">{copy.verificationExpired}</InlineStatus> : null}
        <FormField label={copy.email}>
          {(control) => (
            <Input
              {...control}
              size="lg"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              placeholder={copy.emailPlaceholder}
              autoFocus
              required
              leadingIcon={<EnvelopeSimpleIcon aria-hidden="true" />}
            />
          )}
        </FormField>
        <PasswordField
          label={copy.password}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          placeholder={copy.passwordPlaceholder}
        />
        <Button type="submit" size="auth" loading={pending}>
          {copy.submit}
        </Button>
      </form>
    </AuthLayout>
  );
}
