import type { FieldDefinition } from '@archlin/modules-knowledge/shared';
import { FormField } from '@archlin/ui/components/form-field';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { Input } from '@archlin/ui/components/input';
import { NativeSelect } from '@archlin/ui/components/native-select';
import { Textarea } from '@archlin/ui/components/textarea';
import { useState } from 'react';
import { parseNumberInput } from './number-field';

// Label column beside the control from 640px up, stacked below that; the message always lines up with the control.
export const ROW_LAYOUT =
  'sm:grid sm:grid-cols-[160px_minmax(0,1fr)] sm:items-start sm:gap-x-3 sm:[&>:first-child]:pt-2.5 sm:[&>:nth-child(n+3)]:col-start-2';

export interface TypeFieldLabels {
  notFilled: string;
  select: string;
  urlPlaceholder: string;
  numberInvalid: string;
  legacy(value: string): string;
}

export interface TypeFieldProps {
  field: FieldDefinition;
  value: unknown;
  missing: boolean;
  // The stored value rendered as text when it no longer fits the field type, otherwise null.
  legacyText: string | null;
  error: string | undefined;
  invalidAttempt: number;
  readOnly: boolean;
  labels: TypeFieldLabels;
  // undefined clears the property.
  onChange(value: string | number | undefined): void;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value).replace('.', ',') : '';
}

export function TypeField({
  field,
  value,
  missing,
  legacyText,
  error,
  invalidAttempt,
  readOnly,
  labels,
  onChange,
}: TypeFieldProps) {
  const [rawNumber, setRawNumber] = useState(() => numberText(value));
  const [numberAttempt, setNumberAttempt] = useState(0);
  const [numberInvalid, setNumberInvalid] = useState(false);
  const shownError = numberInvalid ? labels.numberInvalid : error;

  function commitText(next: string): void {
    onChange(next === '' ? undefined : next);
  }

  function commitNumber(raw: string): void {
    setRawNumber(raw);
    const parsed = parseNumberInput(raw);
    if (!parsed.ok) {
      setNumberInvalid(true);
      setNumberAttempt((count) => count + 1);
      return;
    }
    setNumberInvalid(false);
    onChange(parsed.value ?? undefined);
  }

  return (
    <div>
      <FormField
        label={field.label}
        labelAside={missing ? <span className="text-micro text-attention">{labels.notFilled}</span> : undefined}
        error={shownError}
        invalidAttempt={numberInvalid ? numberAttempt : invalidAttempt}
        className={ROW_LAYOUT}
      >
        {(control) => {
          switch (field.type) {
            case 'text':
              return (
                <Input
                  {...control}
                  value={asText(value)}
                  maxLength={500}
                  disabled={readOnly}
                  onChange={(event) => commitText(event.target.value)}
                />
              );
            case 'longtext':
              return (
                <Textarea
                  {...control}
                  value={asText(value)}
                  maxLength={10_000}
                  disabled={readOnly}
                  onChange={(event) => commitText(event.target.value)}
                />
              );
            case 'date':
              return (
                <Input
                  {...control}
                  type="date"
                  value={/^\d{4}-\d{2}-\d{2}$/.test(asText(value)) ? asText(value) : ''}
                  disabled={readOnly}
                  onChange={(event) => commitText(event.target.value)}
                />
              );
            case 'select': {
              const options = field.options ?? [];
              const current = asText(value);
              return (
                <NativeSelect
                  {...control}
                  value={options.includes(current) ? current : ''}
                  disabled={readOnly}
                  onChange={(event) => commitText(event.target.value)}
                >
                  <option value="">{labels.select}</option>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </NativeSelect>
              );
            }
            case 'url':
              return (
                <Input
                  {...control}
                  type="url"
                  value={asText(value)}
                  maxLength={2000}
                  placeholder={labels.urlPlaceholder}
                  disabled={readOnly}
                  onChange={(event) => commitText(event.target.value)}
                />
              );
            case 'number':
              return (
                <Input
                  {...control}
                  inputMode="decimal"
                  value={rawNumber}
                  disabled={readOnly}
                  onChange={(event) => commitNumber(event.target.value)}
                />
              );
          }
        }}
      </FormField>
      {legacyText === null ? null : (
        <InlineStatus variant="info" className="mt-2 sm:ml-[172px]">
          {labels.legacy(legacyText)}
        </InlineStatus>
      )}
    </div>
  );
}
