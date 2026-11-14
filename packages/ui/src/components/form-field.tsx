import { WarningIcon } from '@phosphor-icons/react/ssr';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Label } from './label';

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'data-shake'?: 'true';
}

interface FormFieldProps {
  label: string;
  // Sits beside the label, for a status such as a missing required value.
  labelAside?: ReactNode;
  helper?: string | undefined;
  error?: string | undefined;
  invalidAttempt?: number;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

// The render prop hands the control its id and aria wiring so label, helper and error stay linked.
function FormField({ label, labelAside, helper, error, invalidAttempt, className, children }: FormFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hasMessage = error !== undefined || helper !== undefined;
  const [shaking, setShaking] = useState(false);
  const previousAttempt = useRef(invalidAttempt);

  useEffect(() => {
    const previous = previousAttempt.current;
    previousAttempt.current = invalidAttempt;
    if (error === undefined || invalidAttempt === undefined) return;
    if (previous !== undefined && invalidAttempt <= previous) return;
    setShaking(true);
    const timeout = window.setTimeout(() => setShaking(false), 240);
    return () => window.clearTimeout(timeout);
  }, [invalidAttempt, error]);

  const control: FieldControlProps = {
    id,
    'aria-describedby': hasMessage ? messageId : undefined,
    'aria-invalid': error === undefined ? undefined : true,
    ...(shaking ? { 'data-shake': 'true' as const } : {}),
  };

  return (
    <div data-slot="form-field" className={cn('flex flex-col gap-2', className)}>
      {labelAside === undefined ? (
        <Label htmlFor={id}>{label}</Label>
      ) : (
        <div className="flex items-baseline gap-2">
          <Label htmlFor={id}>{label}</Label>
          {labelAside}
        </div>
      )}
      {children(control)}
      {error === undefined ? (
        helper === undefined ? null : (
          <p id={messageId} className="text-micro text-fg-muted">
            {helper}
          </p>
        )
      ) : (
        <p id={messageId} role="alert" className="flex items-center gap-1.5 text-micro text-danger">
          <WarningIcon aria-hidden="true" size={14} className="shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

export { FormField };
