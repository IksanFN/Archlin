import { FormField } from '@archlin/ui/components/form-field';
import { Input } from '@archlin/ui/components/input';
import { NativeSelect } from '@archlin/ui/components/native-select';
import { toast } from '@archlin/ui/components/sonner';
import type { Viewer } from '@archlin/platform/contracts';
import { useRouter } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { formatTimezoneLabel } from '~/lib/timezones';
import { useTimezoneChoices } from '~/lib/use-timezone-choices';
import { updateProfileFn } from '~/server/functions/account';
import { SettingsGroup, SettingsRow } from './settings-row';

const copy = messages.settings.profile;

type Field = 'displayName' | 'timezone';

// No save button (settings pattern McU8d): the name saves on blur or Enter, the zone on change.
export function ProfileSection({ viewer }: { viewer: Viewer }) {
  const router = useRouter();
  const choices = useTimezoneChoices();
  const [displayName, setDisplayName] = useState(viewer.displayName);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [timezone, setTimezone] = useState(viewer.timezone);
  const savedName = useRef(viewer.displayName);

  // The viewer's own zone may be missing from this browser's list; it must still be selectable.
  const zones = choices.options.includes(viewer.timezone) ? choices.options : [viewer.timezone, ...choices.options];
  const now = new Date();

  async function save(next: { displayName: string; timezone: string }, field: Field): Promise<void> {
    setErrors({});
    try {
      await updateProfileFn({ data: next });
      savedName.current = next.displayName;
      setTimezone(next.timezone);
      toast.success(copy.saved);
      await router.invalidate();
    } catch (error) {
      if (field === 'timezone') setTimezone(viewer.timezone);
      const presentation = messageForError(error);
      if (presentation.kind === 'field') setErrors({ [field]: presentation.fields.displayName ?? presentation.fields.timezone ?? messages.errors.invalidField });
      else if (presentation.kind === 'toast') toast.error(presentation.text);
    }
  }

  function commitName(): void {
    const trimmed = displayName.trim();
    if (trimmed === savedName.current) return;
    if (trimmed === '') {
      setDisplayName(savedName.current);
      return;
    }
    void save({ displayName: trimmed, timezone }, 'displayName');
  }

  function onNameKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') event.currentTarget.blur();
  }

  return (
    <SettingsGroup label={copy.group}>
      <SettingsRow title={copy.displayName}>
        <FormField label={copy.displayName} error={errors.displayName} className="w-full sm:w-[220px] [&>label]:sr-only">
          {(control) => (
            <Input
              {...control}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              onBlur={commitName}
              onKeyDown={onNameKeyDown}
              autoComplete="name"
              maxLength={80}
            />
          )}
        </FormField>
      </SettingsRow>
      <SettingsRow
        title={copy.email}
        description={
          <>
            <span className="block text-fg-secondary">{viewer.email}</span>
            <span className="block">{copy.emailNote}</span>
          </>
        }
      />
      <SettingsRow title={copy.timezone} description={copy.timezoneHelper}>
        <FormField label={copy.timezone} error={errors.timezone} className="w-full sm:w-[220px] [&>label]:sr-only">
          {(control) => (
            <NativeSelect
              {...control}
              value={timezone}
              onChange={(event) => {
                setTimezone(event.target.value);
                void save({ displayName: savedName.current, timezone: event.target.value }, 'timezone');
              }}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {formatTimezoneLabel(zone, now)}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </SettingsRow>
    </SettingsGroup>
  );
}
