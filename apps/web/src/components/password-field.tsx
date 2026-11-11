import { Button } from '@archlin/ui/components/button';
import { FormField } from '@archlin/ui/components/form-field';
import { Input } from '@archlin/ui/components/input';
import { cn } from '@archlin/ui/lib/utils';
import { EyeIcon, EyeSlashIcon, LockSimpleIcon } from '@phosphor-icons/react/ssr';
import { useState } from 'react';
import { messages } from '~/i18n/id';
import { passwordMeter } from '~/lib/password-meter';

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  error?: string | undefined;
  size?: 'default' | 'lg';
  // Shows the length meter; only set it where the user is choosing a new password.
  meter?: boolean;
  autoFocus?: boolean;
}

function LengthMeter({ value }: { value: string }) {
  const { segments, sufficient, text } = passwordMeter(value);
  return (
    <div className="flex flex-col gap-1.5">
      <div aria-hidden="true" className="flex gap-1">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn('h-[3px] flex-1 rounded-pill', index < segments ? (sufficient ? 'bg-success' : 'bg-inverse') : 'bg-surface-hover')}
          />
        ))}
      </div>
      <p className="text-micro text-fg-muted">{text}</p>
    </div>
  );
}

export function PasswordField({ label, value, onChange, autoComplete, error, size = 'lg', meter = false, autoFocus }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <FormField label={label} error={error}>
      {(control) => (
        <>
          <Input
            {...control}
            size={size}
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoComplete={autoComplete}
            autoFocus={autoFocus}
            required
            leadingIcon={size === 'lg' ? <LockSimpleIcon aria-hidden="true" /> : undefined}
            trailing={
              <Button
                variant="icon"
                size="icon-sm"
                aria-label={visible ? messages.password.hide : messages.password.show}
                aria-pressed={visible}
                className="-mr-1.5 bg-transparent text-fg-muted hover:bg-surface-hover"
                onClick={() => setVisible((current) => !current)}
              >
                {visible ? <EyeSlashIcon aria-hidden="true" size={16} /> : <EyeIcon aria-hidden="true" size={16} />}
              </Button>
            }
          />
          {meter ? <LengthMeter value={value} /> : null}
        </>
      )}
    </FormField>
  );
}
