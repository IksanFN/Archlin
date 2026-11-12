import { WarningIcon } from '@phosphor-icons/react/ssr';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Label } from './label';

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

interface FormFieldProps {
  label: string;
  helper?: string;
  error?: string | undefined;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

// The render prop hands the control its id and aria wiring so label, helper and error stay linked.
function FormField({ label, helper, error, className, children }: FormFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hasMessage = error !== undefined || helper !== undefined;
  return (
    <div data-slot="form-field" className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, 'aria-describedby': hasMessage ? messageId : undefined, 'aria-invalid': error === undefined ? undefined : true })}
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
