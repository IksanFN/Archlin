import { useLayoutEffect, useRef } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { EditorLabels } from './labels';

const TITLE_MAX = 500;

export function singleLineTitle(value: string, max = TITLE_MAX): string {
  return value.replace(/[\r\n]+/g, '').slice(0, max);
}

export function TitleInput({
  value,
  onChange,
  onEnter,
  labels,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  labels: EditorLabels;
  readOnly: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    onChange(singleLineTitle(event.target.value));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onEnter();
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      maxLength={TITLE_MAX}
      aria-label={labels.title}
      placeholder={labels.untitled}
      value={value}
      readOnly={readOnly}
      className="w-full resize-none overflow-hidden bg-transparent text-h1 text-fg outline-none placeholder:text-fg-muted"
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    />
  );
}
