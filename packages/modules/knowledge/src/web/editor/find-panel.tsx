import { Button } from '@archlin/ui/components/button';
import { Input } from '@archlin/ui/components/input';
import { Label } from '@archlin/ui/components/label';
import { XIcon } from '@phosphor-icons/react/ssr';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useEffect, useId } from 'react';
import type { KeyboardEvent } from 'react';
import { findReplaceKey } from './find-replace';
import type { EditorLabels } from './labels';

export function FindPanel({ editor, labels }: { editor: Editor; labels: EditorLabels }) {
  const findId = useId();
  const replaceId = useId();
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => findReplaceKey.getState(instance.state) ?? null,
  });
  const open = state?.open ?? false;
  const openedAt = state?.openedAt ?? 0;

  useEffect(() => {
    if (!open) return;
    const input = document.getElementById(findId);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }, [findId, open, openedAt]);

  if (state === null || !state.open) return null;

  const total = state.matches.length;
  const current = total === 0 ? 0 : state.activeIndex + 1;
  const editable = editor.isEditable;

  function onFindKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      editor.commands.closeFind();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) editor.commands.findPrevious();
      else editor.commands.findNext();
    }
  }

  return (
    <div className="kb-find-panel mb-3 grid gap-2 rounded-lg border border-line-subtle bg-surface-raised p-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-40 flex-1 gap-1">
          <Label htmlFor={findId} className="text-micro text-fg-muted">
            {labels.find.find}
          </Label>
          <Input
            id={findId}
            value={state.query}
            autoComplete="off"
            onChange={(event) => {
              editor.commands.setFindQuery(event.target.value);
            }}
            onKeyDown={onFindKeyDown}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.find.caseSensitive}
          aria-pressed={state.caseSensitive}
          className={state.caseSensitive ? 'bg-overlay text-fg' : undefined}
          onClick={() => {
            editor.commands.toggleFindCase();
          }}
        >
          Aa
        </Button>
        <p className="text-micro text-fg-muted" aria-live="polite">
          {labels.find.count(current, total)}
        </p>
        <Button type="button" variant="ghost" size="row" onClick={() => editor.commands.findPrevious()}>
          {labels.find.previous}
        </Button>
        <Button type="button" variant="ghost" size="row" onClick={() => editor.commands.findNext()}>
          {labels.find.next}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.find.close}
          onClick={() => editor.commands.closeFind()}
        >
          <XIcon aria-hidden="true" size={16} />
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-40 flex-1 gap-1">
          <Label htmlFor={replaceId} className="text-micro text-fg-muted">
            {labels.find.replace}
          </Label>
          <Input
            id={replaceId}
            value={state.replacement}
            autoComplete="off"
            disabled={!editable}
            onChange={(event) => {
              editor.commands.setFindReplacement(event.target.value);
            }}
            onKeyDown={onFindKeyDown}
          />
        </div>
        <Button type="button" variant="ghost" size="row" disabled={!editable} onClick={() => editor.commands.replaceFind()}>
          {labels.find.replaceOne}
        </Button>
        <Button type="button" variant="ghost" size="row" disabled={!editable} onClick={() => editor.commands.replaceAllFind()}>
          {labels.find.replaceAll}
        </Button>
      </div>
    </div>
  );
}
