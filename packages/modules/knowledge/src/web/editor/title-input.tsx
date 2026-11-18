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
    const resize = (): void => {
      // Collapsing the title may hide the page scrollbar and change wrapping.
      const inlineWidth = el.style.width;
      el.style.width = getComputedStyle(el).width;
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
      el.style.width = inlineWidth;
    };
    let width = el.getBoundingClientRect().width;
    resize();
    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      const nextWidth = el.getBoundingClientRect().width;
      // Height changes are our own output; only a new width changes wrapping.
      if (nextWidth === width) return;
      width = nextWidth;
      if (frame !== undefined) cancelAnimationFrame(frame);
      // Write outside observer delivery so other layout observers can settle.
      frame = requestAnimationFrame(resize);
    });
    observer.observe(el);
    let active = true;
    // Font metrics can change wrapping even when the field width stays fixed.
    void document.fonts.ready.then(() => {
      if (active) resize();
    });
    document.fonts.addEventListener('loadingdone', resize);
    return () => {
      active = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', resize);
    };
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
      className="w-full resize-none overflow-hidden bg-transparent text-h1 text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:[outline-style:solid] placeholder:text-fg-muted"
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    />
  );
}
