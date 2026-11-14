import { isAllowedLink } from '@archlin/modules-knowledge/shared';
import { Button } from '@archlin/ui/components/button';
import { FormField } from '@archlin/ui/components/form-field';
import { Input } from '@archlin/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@archlin/ui/components/popover';
import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { EditorLabels } from './labels';

function LinkPopoverForm({
  editor,
  labels,
  onClose,
}: {
  editor: Editor;
  labels: EditorLabels;
  onClose: () => void;
}) {
  const href = editor.getAttributes('link').href;
  const [url, setUrl] = useState(typeof href === 'string' ? href : '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [invalidAttempt, setInvalidAttempt] = useState(0);

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = url.trim();
    if (!isAllowedLink(next)) {
      setError(labels.linkInvalid);
      setInvalidAttempt((current) => current + 1);
      return;
    }
    editor.chain().focus().setLink({ href: next }).run();
    onClose();
  }

  function remove(): void {
    editor.chain().focus().unsetLink().run();
    onClose();
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      <FormField label={labels.linkUrl} error={error} invalidAttempt={invalidAttempt}>
        {(control) => (
          <Input
            {...control}
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="row" onClick={remove}>
          {labels.linkRemove}
        </Button>
        <Button type="submit" size="row">
          {labels.linkSave}
        </Button>
      </div>
    </form>
  );
}

export function LinkPopover({
  editor,
  labels,
  children,
}: {
  editor: Editor;
  labels: EditorLabels;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(100vw-2rem,20rem)]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {open ? <LinkPopoverForm editor={editor} labels={labels} onClose={() => setOpen(false)} /> : null}
      </PopoverContent>
    </Popover>
  );
}
