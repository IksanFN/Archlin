import { SmileyIcon, XIcon } from '@phosphor-icons/react/ssr';
import { useState } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface EmojiFieldLabels {
  trigger: string;
  input: string;
  remove: string;
  invalid: string;
}

export interface EmojiFieldProps {
  value: string | null;
  onChange: (next: string | null) => void;
  isValid: (value: string) => boolean;
  labels: EmojiFieldLabels;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}

function EmojiEditor({
  value,
  isValid,
  labels,
  onChange,
  onClose,
}: {
  value: string | null;
  isValid: (value: string) => boolean;
  labels: EmojiFieldLabels;
  onChange: (next: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);

  function commit(next: string): void {
    if (next === '') {
      setInvalid(false);
      return;
    }
    if (!isValid(next)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(next);
    onClose();
  }

  return (
    <>
      <Input
        aria-label={labels.input}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          commit(next.trim());
        }}
        {...(invalid ? { 'aria-invalid': true as const } : {})}
        autoFocus
      />
      {invalid ? (
        <p role="alert" className="mt-2 text-micro text-danger">
          {labels.invalid}
        </p>
      ) : null}
      {value === null ? null : (
        <button
          type="button"
          className="mt-2 flex h-8 w-full items-center gap-2 rounded-sm px-2 text-small text-fg-secondary fine-hover:bg-overlay"
          onClick={() => {
            onChange(null);
            onClose();
          }}
        >
          <XIcon aria-hidden="true" size={14} />
          {labels.remove}
        </button>
      )}
    </>
  );
}

function EmojiField({ value, onChange, isValid, labels, open, onOpenChange, hideTrigger = false }: EmojiFieldProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;

  function setOpen(next: boolean): void {
    onOpenChange?.(next);
    if (open === undefined) setUncontrolledOpen(next);
  }

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="icon"
          size="icon-sm"
          aria-label={labels.trigger}
          className={hideTrigger ? 'sr-only' : 'bg-transparent hover:bg-overlay'}
        >
          {value === null || value === '' ? <SmileyIcon aria-hidden="true" size={18} /> : <span className="text-[18px] leading-none">{value}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3">
        {isOpen ? (
          <EmojiEditor value={value} isValid={isValid} labels={labels} onChange={onChange} onClose={() => setOpen(false)} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export { EmojiField };
