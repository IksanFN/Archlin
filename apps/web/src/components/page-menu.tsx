import { ChangeTypeDialog } from '@archlin/modules-knowledge/web';
import { Button } from '@archlin/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@archlin/ui/components/dropdown-menu';
import { cn } from '@archlin/ui/lib/utils';
import { DotsThreeIcon } from '@phosphor-icons/react/ssr';
import { useState } from 'react';
import type { Ref } from 'react';
import { messages } from '~/i18n/id';

export function PageMenu({
  entityId,
  prepareTypeChange,
  noteTypeId,
  trashed,
  triggerRef,
  onOpenHistory,
  onSaveVersion,
  onMove,
  onTrash,
  onTypeChanged,
}: {
  entityId: string;
  // Resolves to the saved base version, or null while unsaved edits would make the change conflict with itself.
  prepareTypeChange: () => Promise<number | null>;
  noteTypeId: string;
  trashed: boolean;
  triggerRef: Ref<HTMLButtonElement>;
  onOpenHistory: () => void;
  onSaveVersion: () => void;
  onMove: () => void;
  onTrash: () => void;
  onTypeChanged: () => void;
}) {
  const [changingType, setChangingType] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={triggerRef} variant="icon" size="icon-sm" aria-label={messages.page.options} className="bg-transparent hover:bg-overlay">
            <DotsThreeIcon aria-hidden="true" size={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setChangingType(true)}>{messages.page.changeType}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenHistory}>{messages.page.history}</DropdownMenuItem>
          <DropdownMenuItem disabled={trashed} onSelect={onSaveVersion}>{messages.page.saveVersion}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onMove}>{messages.tree.moveTo}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onTrash} className={cn('text-danger data-[highlighted]:text-danger')}>
            {messages.tree.moveToTrash}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangeTypeDialog
        key={noteTypeId}
        entityId={entityId}
        noteTypeId={noteTypeId}
        open={changingType}
        onOpenChange={setChangingType}
        prepareTypeChange={prepareTypeChange}
        onChanged={onTypeChanged}
        labels={messages.noteTypes}
      />
    </>
  );
}
