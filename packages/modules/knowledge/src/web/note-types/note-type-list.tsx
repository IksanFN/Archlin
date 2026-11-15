import { emptyDocument } from '@archlin/modules-knowledge/shared';
import type { NoteTypeSummary } from '@archlin/modules-knowledge/shared';
import { Badge } from '@archlin/ui/components/badge';
import { Button } from '@archlin/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@archlin/ui/components/dialog';
import { FormField } from '@archlin/ui/components/form-field';
import { Input } from '@archlin/ui/components/input';
import { NumberFlip } from '@archlin/ui/components/number-flip';
import { toast } from '@archlin/ui/components/sonner';
import { prefersReducedMotion } from '@archlin/ui/lib/motion';
import { ArrowDownIcon, ArrowUpIcon } from '@phosphor-icons/react/ssr';
import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useKnowledgeClient } from '../client';
import type { NoteTypeLabels } from './labels';

const FLIP_MS = 200;
const FLIP_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';

export function NoteTypeList({
  types,
  labels,
  onChanged,
  onCreated,
  renderLink,
}: {
  types: readonly NoteTypeSummary[];
  labels: NoteTypeLabels;
  // Called after a reorder attempt, so the screen can load the list again.
  onChanged(): void;
  onCreated(id: string): void;
  renderLink(type: NoteTypeSummary, className: string, children: ReactNode): ReactNode;
}) {
  const client = useKnowledgeClient();
  const [items, setItems] = useState(types);
  const [seen, setSeen] = useState(types);
  const [creating, setCreating] = useState(false);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const tops = useRef(new Map<string, number>());
  const order = items.map((item) => item.id).join();

  if (types !== seen) {
    setSeen(types);
    setItems(types);
  }

  // Rows swap by animating from their old offset to the new one; transform only, so layout never animates.
  useLayoutEffect(() => {
    for (const [id, element] of rows.current) {
      const before = tops.current.get(id);
      const now = element.offsetTop;
      if (before !== undefined && before !== now && !prefersReducedMotion()) {
        element.animate([{ transform: `translateY(${before - now}px)` }, { transform: 'none' }], {
          duration: FLIP_MS,
          easing: FLIP_EASING,
        });
      }
      tops.current.set(id, now);
    }
  }, [order]);

  async function move(index: number, direction: 'up' | 'down'): Promise<void> {
    const moved = items[index];
    const neighbourIndex = direction === 'up' ? index - 1 : index + 1;
    const neighbour = items[neighbourIndex];
    if (moved === undefined || neighbour === undefined) return;
    const next = [...items];
    next[index] = neighbour;
    next[neighbourIndex] = moved;
    setItems(next);
    try {
      await client.reorderNoteType(
        direction === 'up'
          ? { id: moved.id, beforeId: neighbour.id, afterId: null }
          : { id: moved.id, beforeId: null, afterId: neighbour.id },
      );
    } catch {
      setItems(items);
      toast.error(labels.loadFailed);
    }
    onChanged();
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 text-fg">{labels.title}</h1>
          <p className="text-small text-fg-muted">{labels.description}</p>
        </div>
        <Button className="shrink-0" onClick={() => setCreating(true)}>
          {labels.newType}
        </Button>
      </div>
      <ul className="mt-8 flex flex-col">
        {items.map((type, index) => (
          <li
            key={type.id}
            ref={(node) => {
              if (node === null) rows.current.delete(type.id);
              else rows.current.set(type.id, node);
            }}
            style={{ '--rise-index': index } as CSSProperties}
            className="rise flex items-center gap-3 border-b border-line-subtle py-3 last:border-b-0"
          >
            <span className="flex size-6 shrink-0 items-center justify-center text-[18px] leading-none">{type.icon}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {renderLink(type, 'truncate rounded-sm text-ui font-medium text-fg hover:underline', type.name)}
              <span className="font-mono text-[12px] leading-4 text-fg-muted">{type.key}</span>
            </div>
            {type.isSystem ? <Badge>{labels.system}</Badge> : null}
            <span className="hidden text-small text-fg-muted sm:inline">{labels.fieldCount(type.fieldSchema.length)}</span>
            <span className="flex items-baseline gap-1 text-small text-fg-muted">
              <NumberFlip value={type.pageCount} />
              {labels.pageUnit}
            </span>
            <div className="flex gap-1">
              <Button
                variant="icon"
                size="icon-sm"
                aria-label={labels.moveUp(type.name)}
                disabled={index === 0}
                onClick={() => void move(index, 'up')}
              >
                <ArrowUpIcon aria-hidden="true" size={16} />
              </Button>
              <Button
                variant="icon"
                size="icon-sm"
                aria-label={labels.moveDown(type.name)}
                disabled={index === items.length - 1}
                onClick={() => void move(index, 'down')}
              >
                <ArrowDownIcon aria-hidden="true" size={16} />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <CreateTypeDialog open={creating} onOpenChange={setCreating} onCreated={onCreated} labels={labels} />
    </>
  );
}

function CreateTypeDialog({
  open,
  onOpenChange,
  onCreated,
  labels,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(id: string): void;
  labels: NoteTypeLabels;
}) {
  const client = useKnowledgeClient();
  const [name, setName] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [showError, setShowError] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = labels.create;

  async function submit(): Promise<void> {
    if (name.trim() === '') {
      setShowError(true);
      setAttempt((count) => count + 1);
      return;
    }
    setBusy(true);
    try {
      const created = await client.createNoteType({
        name: name.trim(),
        icon: null,
        fieldSchema: [],
        template: emptyDocument(),
        defaultReviewMode: 'none',
      });
      setName('');
      setShowError(false);
      onOpenChange(false);
      onCreated(created.id);
    } catch {
      toast.error(labels.editor.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
          </DialogHeader>
          <FormField
            label={copy.name}
            error={showError && name.trim() === '' ? copy.nameRequired : undefined}
            invalidAttempt={attempt}
          >
            {(control) => (
              <Input
                {...control}
                value={name}
                maxLength={60}
                placeholder={copy.placeholder}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={busy}>
                {copy.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              {copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
