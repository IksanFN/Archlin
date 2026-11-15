import { FIELD_TYPES } from '@archlin/modules-knowledge/shared';
import type { FieldType } from '@archlin/modules-knowledge/shared';
import { Button } from '@archlin/ui/components/button';
import { ChipInput } from '@archlin/ui/components/chip-input';
import { FormField } from '@archlin/ui/components/form-field';
import { Input } from '@archlin/ui/components/input';
import { NativeSelect } from '@archlin/ui/components/native-select';
import { SegmentedControl } from '@archlin/ui/components/segmented-control';
import { Switch } from '@archlin/ui/components/switch';
import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from '@phosphor-icons/react/ssr';
import type { FieldRowState, RowProblems, SearchWeight } from './field-rows';
import type { NoteTypeLabels } from './labels';

const MAX_OPTIONS = 30;

export function FieldRow({
  row,
  index,
  count,
  problems,
  invalidAttempt,
  leaving,
  autoFocus,
  labels,
  onLabelChange,
  onChange,
  onMove,
  onDelete,
}: {
  row: FieldRowState;
  index: number;
  count: number;
  problems: RowProblems;
  invalidAttempt: number;
  leaving: boolean;
  autoFocus: boolean;
  labels: NoteTypeLabels;
  onLabelChange(label: string): void;
  onChange(patch: Partial<FieldRowState>): void;
  onMove(direction: 'up' | 'down'): void;
  onDelete(): void;
}) {
  const copy = labels.editor;
  const name = row.label.trim() === '' ? copy.untitledField : row.label;
  const weights: { value: SearchWeight; label: string }[] = [
    { value: 'B', label: copy.weightHigh },
    { value: 'C', label: copy.weightNormal },
    { value: 'none', label: copy.weightNone },
  ];

  return (
    <li
      data-slot="field-row"
      data-leaving={leaving ? 'true' : undefined}
      className="enter-item flex flex-col gap-3 border-b border-line-subtle py-4 last:border-b-0"
    >
      <div className="flex flex-col gap-1.5">
        <FormField
          label={copy.fieldLabel}
          error={problems.label === true ? copy.fieldLabelRequired : undefined}
          invalidAttempt={invalidAttempt}
        >
          {(control) => (
            <Input
              {...control}
              value={row.label}
              maxLength={60}
              autoFocus={autoFocus}
              placeholder={copy.fieldLabelPlaceholder}
              onChange={(event) => onLabelChange(event.target.value)}
            />
          )}
        </FormField>
        <p className="font-mono text-[12px] leading-4 text-fg-muted">{row.key}</p>
      </div>
      <FormField
        label={copy.fieldType}
        helper={row.persisted ? copy.typeLocked : undefined}
        error={problems.type === true ? copy.typeLocked : undefined}
        invalidAttempt={invalidAttempt}
      >
        {(control) => (
          <NativeSelect
            {...control}
            value={row.type}
            disabled={row.persisted}
            onChange={(event) => onChange({ type: event.target.value as FieldType })}
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {labels.fieldTypes[type]}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {row.type === 'select' ? (
        <FormField
          label={copy.options}
          error={problems.options === true ? copy.optionsRequired : undefined}
          invalidAttempt={invalidAttempt}
        >
          {(control) => (
            <ChipInput
              {...control}
              values={row.options}
              onChange={(options) => onChange({ options })}
              max={MAX_OPTIONS}
              maxChipLength={60}
              labels={{ input: copy.optionsPlaceholder, remove: copy.removeOption, limit: copy.optionsLimit }}
            />
          )}
        </FormField>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-small font-medium text-fg">{copy.required}</span>
          <span className="text-micro text-fg-muted">{copy.requiredHelper}</span>
        </div>
        <Switch
          aria-label={`${copy.required}: ${name}`}
          checked={row.required}
          onCheckedChange={(required) => onChange({ required })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-small font-medium text-fg">{copy.searchWeight}</span>
        <SegmentedControl
          aria-label={`${copy.searchWeight}: ${name}`}
          value={row.searchWeight}
          onValueChange={(searchWeight) => onChange({ searchWeight })}
          options={weights}
        />
        <span className="text-micro text-fg-muted">{copy.weightHelper}</span>
      </div>
      {row.type === 'date' ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <span className="text-small font-medium text-fg">{copy.remind}</span>
            <Switch
              aria-label={`${copy.remind}: ${name}`}
              checked={row.remindDays !== null}
              onCheckedChange={(on) => onChange({ remindDays: on ? 7 : null })}
            />
          </div>
          {row.remindDays === null ? null : (
            <FormField
              label={copy.remindDays}
              error={problems.remind === true ? copy.remindInvalid : undefined}
              invalidAttempt={invalidAttempt}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={0}
                  max={365}
                  value={String(row.remindDays)}
                  className="w-32"
                  onChange={(event) => {
                    const parsed = event.target.valueAsNumber;
                    onChange({ remindDays: Number.isNaN(parsed) ? 0 : Math.trunc(parsed) });
                  }}
                />
              )}
            </FormField>
          )}
          <span className="text-micro text-fg-muted">{copy.remindHelper}</span>
        </div>
      ) : null}
      <div className="flex gap-1">
        <Button
          variant="icon"
          size="icon-sm"
          aria-label={copy.moveField(name, 'up')}
          disabled={index === 0}
          onClick={() => onMove('up')}
        >
          <ArrowUpIcon aria-hidden="true" size={16} />
        </Button>
        <Button
          variant="icon"
          size="icon-sm"
          aria-label={copy.moveField(name, 'down')}
          disabled={index === count - 1}
          onClick={() => onMove('down')}
        >
          <ArrowDownIcon aria-hidden="true" size={16} />
        </Button>
        <Button variant="icon" size="icon-sm" aria-label={copy.deleteField(name)} onClick={onDelete}>
          <TrashIcon aria-hidden="true" size={16} />
        </Button>
      </div>
    </li>
  );
}
