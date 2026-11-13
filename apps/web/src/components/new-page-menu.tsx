import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@archlin/ui/components/dropdown-menu';
import { toast } from '@archlin/ui/components/sonner';
import type { NoteTypeSummary } from '@archlin/modules-knowledge/shared';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useState, type ReactNode } from 'react';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { noteTypesFn } from '~/server/functions/note-types';
import { createPageFn } from '~/server/functions/pages';

const LAST_NOTE_TYPE_KEY = 'archlin.lastNoteType';

function readLastNoteType(): string | null {
  try {
    return window.localStorage.getItem(LAST_NOTE_TYPE_KEY);
  } catch {
    return null;
  }
}

function writeLastNoteType(id: string): void {
  try {
    window.localStorage.setItem(LAST_NOTE_TYPE_KEY, id);
  } catch {
    // Storage may be blocked; creating the page still succeeds.
  }
}

function orderTypes(types: readonly NoteTypeSummary[]): NoteTypeSummary[] {
  const last = readLastNoteType();
  if (last === null) return [...types];
  return [...types].sort((a, b) => (a.id === last ? -1 : b.id === last ? 1 : 0));
}

export function NewPageMenu({
  spaceId,
  parentId,
  trigger,
  open,
  onOpenChange,
  onCreated,
}: {
  spaceId: string;
  parentId: string | null;
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: (result: { entityId: string; spaceSlug: string }) => void;
}) {
  const router = useRouter();
  const [uncontrolled, setUncontrolled] = useState(false);
  const [types, setTypes] = useState<NoteTypeSummary[] | null>(null);
  const isOpen = open ?? uncontrolled;

  const setOpen = useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (open === undefined) setUncontrolled(next);
    },
    [onOpenChange, open],
  );

  async function handleOpenChange(next: boolean): Promise<void> {
    setOpen(next);
    if (!next || types !== null) return;
    try {
      setTypes(orderTypes(await noteTypesFn({ data: {} })));
    } catch (error) {
      const presentation = messageForError(error);
      if (presentation.kind === 'toast') toast.error(presentation.text);
      setOpen(false);
    }
  }

  async function choose(noteTypeId: string): Promise<void> {
    try {
      const created = await createPageFn({ data: { spaceId, parentId, noteTypeId, placement: 'last' } });
      writeLastNoteType(noteTypeId);
      setOpen(false);
      onCreated?.(created);
      router.history.push(`/s/${created.spaceSlug}/p/${created.entityId}?focus=title`);
    } catch (error) {
      const presentation = messageForError(error);
      if (presentation.kind === 'toast') toast.error(presentation.text);
    }
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={(next) => void handleOpenChange(next)}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom">
        <DropdownMenuLabel>{messages.newPage.label}</DropdownMenuLabel>
        {(types ?? []).map((type) => (
          <DropdownMenuItem key={type.id} onSelect={() => void choose(type.id)}>
            <span className="flex size-4 items-center justify-center">{type.icon ?? null}</span>
            {type.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
