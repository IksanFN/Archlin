import { Button } from '@archlin/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@archlin/ui/components/dropdown-menu';
import { toast } from '@archlin/ui/components/sonner';
import { cn } from '@archlin/ui/lib/utils';
import type { NoteTypeSummary } from '@archlin/modules-knowledge/shared';
import { DotsThreeIcon } from '@phosphor-icons/react/ssr';
import { useState } from 'react';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { noteTypesFn } from '~/server/functions/note-types';
import { changeNoteTypeFn } from '~/server/functions/pages';

export function PageMenu({
  entityId,
  prepareTypeChange,
  noteTypeId,
  onMove,
  onTrash,
  onTypeChanged,
}: {
  entityId: string;
  // Resolves to the saved base version, or null while unsaved edits would make the change conflict with itself.
  prepareTypeChange: () => Promise<number | null>;
  noteTypeId: string;
  onMove: () => void;
  onTrash: () => void;
  onTypeChanged: () => void;
}) {
  const [types, setTypes] = useState<NoteTypeSummary[] | null>(null);

  async function handleOpenChange(open: boolean): Promise<void> {
    if (!open || types !== null) return;
    try {
      setTypes(await noteTypesFn({ data: {} }));
    } catch (error) {
      const presentation = messageForError(error);
      if (presentation.kind === 'toast') toast.error(presentation.text);
    }
  }

  async function chooseType(nextId: string): Promise<void> {
    if (nextId === noteTypeId) return;
    try {
      const baseVersion = await prepareTypeChange();
      if (baseVersion === null) {
        toast.error(messages.page.changeTypeBlocked);
        return;
      }
      await changeNoteTypeFn({ data: { entityId, baseVersion, noteTypeId: nextId } });
      onTypeChanged();
    } catch (error) {
      const presentation = messageForError(error);
      if (presentation.kind === 'toast') toast.error(presentation.text);
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => void handleOpenChange(open)}>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" size="icon-sm" aria-label={messages.page.options} className="bg-transparent hover:bg-overlay">
          <DotsThreeIcon aria-hidden="true" size={18} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{messages.page.changeType}</DropdownMenuLabel>
        {types === null ? null : (
          <DropdownMenuRadioGroup value={noteTypeId} onValueChange={(next) => void chooseType(next)}>
            {types.map((type) => (
              <DropdownMenuRadioItem key={type.id} value={type.id}>
                <span className="flex size-4 items-center justify-center">{type.icon ?? null}</span>
                {type.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
        <DropdownMenuItem onSelect={onMove}>{messages.tree.moveTo}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onTrash}
          className={cn('text-danger data-[highlighted]:text-danger')}
        >
          {messages.tree.moveToTrash}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
