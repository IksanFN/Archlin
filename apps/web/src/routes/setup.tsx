import { PASSWORD_MIN_CHARS } from '@archlin/platform/contracts';
import { Button } from '@archlin/ui/components/button';
import { FormField } from '@archlin/ui/components/form-field';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { Input } from '@archlin/ui/components/input';
import { NativeSelect } from '@archlin/ui/components/native-select';
import { toast } from '@archlin/ui/components/sonner';
import { EnvelopeSimpleIcon, UserIcon } from '@phosphor-icons/react/ssr';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AuthLayout } from '~/components/auth-layout';
import { PasswordField } from '~/components/password-field';
import { messages } from '~/i18n/id';
import { guardAuthScreen } from '~/lib/auth-guard';
import { messageForError } from '~/lib/client-errors';
import { formatTimezoneLabel } from '~/lib/timezones';
import { useTimezoneChoices } from '~/lib/use-timezone-choices';
import { AppError } from '~/server/errors';
import { setupFn } from '~/server/functions/auth';

const copy = messages.auth.setup;

export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    const { setupConfigured } = await guardAuthScreen('setup');
    return { setupConfigured };
  },
  head: () => ({ meta: [{ title: `${copy.title} · ${messages.appName}` }] }),
  component: SetupPage,
});

type FieldName = 'displayName' | 'email' | 'password' | 'timezone' | 'setupToken';

function SetupPage() {
  const { setupConfigured } = Route.useRouteContext();
  const navigate = useNavigate();
  const choices = useTimezoneChoices();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [chosenTimezone, setChosenTimezone] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [notConfigured, setNotConfigured] = useState(!setupConfigured);
  const [pending, setPending] = useState(false);
  // A ref, not state: two quick clicks can both land before React re-renders with pending=true.
  const submitting = useRef(false);

  const timezone = chosenTimezone ?? choices.initial;
  const now = new Date();

  async function handleFailure(error: unknown): Promise<void> {
    if (error instanceof AppError) {
      if (error.code === 'already_set_up') {
        await navigate({ to: '/login', search: { alasan: 'sudah-disiapkan' } });
        return;
      }
      if (error.code === 'invalid_setup_token') {
        setErrors({ setupToken: copy.setupCodeMismatch });
        return;
      }
      if (error.code === 'setup_not_configured') {
        setNotConfigured(true);
        return;
      }
    }
    const presentation = messageForError(error);
    if (presentation.kind === 'field') setErrors(presentation.fields);
    else if (presentation.kind === 'toast') toast.error(presentation.text);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setErrors({});
    try {
      await setupFn({ data: { setupToken, displayName, email, password, timezone } });
      await navigate({ to: '/' });
    } catch (error) {
      await handleFailure(error);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <AuthLayout title={copy.title} description={copy.description}>
      {notConfigured ? (
        <InlineStatus variant="danger">{copy.notConfigured}</InlineStatus>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
          <FormField label={copy.name} error={errors.displayName}>
            {(control) => (
              <Input
                {...control}
                size="lg"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                placeholder={copy.namePlaceholder}
                autoFocus
                required
                maxLength={80}
                leadingIcon={<UserIcon aria-hidden="true" />}
              />
            )}
          </FormField>
          <FormField label={copy.email} error={errors.email}>
            {(control) => (
              <Input
                {...control}
                size="lg"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder={copy.emailPlaceholder}
                required
                leadingIcon={<EnvelopeSimpleIcon aria-hidden="true" />}
              />
            )}
          </FormField>
          <PasswordField
            label={copy.password}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            placeholder={messages.password.minimumPlaceholder(PASSWORD_MIN_CHARS)}
            error={errors.password}
            meter
          />
          <FormField label={copy.timezone} helper={copy.timezoneHelper} error={errors.timezone}>
            {(control) => (
              <NativeSelect {...control} size="lg" value={timezone} onChange={(event) => setChosenTimezone(event.target.value)}>
                {choices.options.map((zone) => (
                  <option key={zone} value={zone}>
                    {formatTimezoneLabel(zone, now)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField label={copy.setupCode} helper={copy.setupCodeHelper} error={errors.setupToken}>
            {(control) => (
              <Input
                {...control}
                size="lg"
                inputClassName="font-mono"
                value={setupToken}
                onChange={(event) => setSetupToken(event.target.value)}
                autoComplete="off"
                placeholder={copy.setupCodePlaceholder}
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            )}
          </FormField>
          <Button type="submit" size="auth" loading={pending}>
            {copy.submit}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
