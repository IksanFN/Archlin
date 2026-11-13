import { EmojiField } from '@archlin/ui/components/emoji-field';
import { NumberFlip } from '@archlin/ui/components/number-flip';
import { TreeRow } from '@archlin/ui/tree/tree-row';
import { FolderSimpleIcon, PlusIcon } from '@phosphor-icons/react/ssr';
import { isSingleEmoji, type SpaceSummary } from '@archlin/platform/contracts';
import { useRef, useState } from 'react';
import { NewPageMenu } from '~/components/new-page-menu';
import { messages } from '~/i18n/id';
import { updateSpaceFn } from '~/server/functions/spaces';
import { instructionToMove } from './instruction-to-move';
import { EntityList } from './entity-node';
import { RowIconButton, RowMenu, RowMenuItem } from './row-menu';
import { useTree } from './space-tree';
import { dropVisual, useTreeDnd } from './use-tree-dnd';

export function SpaceNode({
  space,
  lastInGroup,
  prevId,
  nextId,
}: {
  space: SpaceSummary;
  lastInGroup: boolean;
  prevId: string | null;
  nextId: string | null;
}) {
  const tree = useTree();
  const rowRef = useRef<HTMLDivElement>(null);
  const [iconOpen, setIconOpen] = useState(false);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const expanded = tree.isExpanded(space.id);
  const menuOpen = tree.menuId === space.id;
  const target = { kind: 'space' as const, spaceId: space.id };
  const mode = expanded && space.pageCount > 0 ? 'expanded' : lastInGroup ? 'last-in-group' : 'standard';
  const visual =
    tree.drop?.id === space.id
      ? { dropState: 'child' as const, dropIndentPx: 0 }
      : dropVisual(null);

  useTreeDnd({
    rowRef,
    draggable: false,
    target,
    level: 1,
    mode,
    expandable: true,
    expanded,
    onHoverExpand: () => tree.expand(space.id),
    onInstruction: (instruction) => tree.setDrop(instruction === null ? null : { id: space.id, instruction }),
    onDrop: (instruction, drag) => {
      const input = instructionToMove(instruction, drag, target);
      if (input !== null) void tree.move(input, drag);
    },
  });

  return (
    <TreeRow
      id={space.id}
      level={1}
      label={space.name}
      icon={space.icon ?? <FolderSimpleIcon aria-hidden="true" size={18} />}
      meta={<NumberFlip value={space.pageCount} />}
      expandable
      expanded={expanded}
      selected={tree.selectedId === space.id}
      tabIndex={tree.focusedId === space.id ? 0 : -1}
      href={`/s/${space.slug}`}
      flash={tree.flashId === space.id}
      leaving={tree.isLeaving(space.id)}
      menuOpen={menuOpen || newPageOpen || iconOpen}
      dropState={visual.dropState}
      dropIndentPx={visual.dropIndentPx}
      rowRef={rowRef}
      onToggle={() => tree.toggle(space.id)}
      onContextMenu={(event) => {
        event.preventDefault();
        tree.setMenuId(space.id);
      }}
      actions={
        <>
          <EmojiField
            value={space.icon}
            hideTrigger
            open={iconOpen}
            onOpenChange={setIconOpen}
            isValid={isSingleEmoji}
            labels={messages.icon}
            onChange={(next) => {
              void updateSpaceFn({ data: { id: space.id, icon: next } }).then(() => tree.reloadSpaces());
            }}
          />
          <NewPageMenu
            spaceId={space.id}
            parentId={null}
            open={newPageOpen}
            onOpenChange={setNewPageOpen}
            trigger={
              <RowIconButton label={messages.tree.newPage}>
                <PlusIcon aria-hidden="true" size={16} />
              </RowIconButton>
            }
            onCreated={() => tree.createdPage(space.id, null, null)}
          />
          <RowMenu open={menuOpen} onOpenChange={(open) => tree.setMenuId(open ? space.id : null)} label={messages.tree.options}>
            <RowMenuItem onSelect={() => setNewPageOpen(true)}>{messages.tree.newPage}</RowMenuItem>
            <RowMenuItem onSelect={() => tree.openRenameSpace(space)}>{messages.tree.rename}</RowMenuItem>
            <RowMenuItem onSelect={() => setIconOpen(true)}>{messages.icon.trigger}</RowMenuItem>
            <RowMenuItem disabled={prevId === null} onSelect={() => void tree.reorderSpace(space.id, 'up', prevId, nextId)}>
              {messages.tree.moveUp}
            </RowMenuItem>
            <RowMenuItem disabled={nextId === null} onSelect={() => void tree.reorderSpace(space.id, 'down', prevId, nextId)}>
              {messages.tree.moveDown}
            </RowMenuItem>
            <RowMenuItem onSelect={() => void tree.archive(space)}>{messages.tree.archive}</RowMenuItem>
          </RowMenu>
        </>
      }
    >
      {expanded ? <EntityList space={space} parentId={null} level={2} ancestors={[]} /> : null}
    </TreeRow>
  );
}
