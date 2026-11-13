import { Button } from '@archlin/ui/components/button';
import { EmojiField } from '@archlin/ui/components/emoji-field';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { Skeleton } from '@archlin/ui/components/skeleton';
import { TreeRow } from '@archlin/ui/tree/tree-row';
import { FileTextIcon, PlusIcon } from '@phosphor-icons/react/ssr';
import { isSingleEmoji, type SpaceSummary, type TreeNode } from '@archlin/platform/contracts';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { NewPageMenu } from '~/components/new-page-menu';
import { messages } from '~/i18n/id';
import { branchKey, useBranch } from '~/lib/tree-store';
import { renamePageFn } from '~/server/functions/pages';
import { setIconFn } from '~/server/functions/tree';
import { instructionToMove } from './instruction-to-move';
import { RowIconButton, RowMenu, RowMenuItem, RowMenuSeparator } from './row-menu';
import { useTree } from './space-tree';
import { dropVisual, useTreeDnd } from './use-tree-dnd';

function RenameInput({
  title,
  onCommit,
  onCancel,
}: {
  title: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(title);
  const canceled = useRef(false);
  return (
    <input
      value={draft}
      aria-label={messages.tree.rename}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit(draft);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          canceled.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!canceled.current) onCommit(draft);
      }}
      className="min-w-0 flex-1 bg-transparent outline-none"
    />
  );
}

export function EntityList({
  space,
  parentId,
  level,
  ancestors,
}: {
  space: SpaceSummary;
  parentId: string | null;
  level: number;
  ancestors: readonly { id: string; parentId: string | null }[];
}) {
  const tree = useTree();
  const key = branchKey(space.id, parentId);
  const state = useBranch(tree.store, key);

  useEffect(() => {
    tree.store.ensure(key);
  }, [key, tree.store]);

  if (state.status === 'idle' || (state.status === 'loading' && state.nodes === null)) {
    return (
      <>
        <Skeleton className="ml-4 h-11" />
        <Skeleton className="ml-4 h-11" />
      </>
    );
  }
  if (state.status === 'error' && state.nodes === null) {
    return (
      <div className="flex flex-col gap-2 px-[14px] py-1">
        <InlineStatus variant="danger">{messages.tree.loadFailed}</InlineStatus>
        <Button variant="secondary" size="row" onClick={() => tree.store.ensure(key)}>
          {messages.common.retry}
        </Button>
      </div>
    );
  }
  const nodes = state.nodes ?? [];
  if (nodes.length === 0) {
    return level === 2 ? <p className="px-[14px] py-1 text-small text-fg-muted">{messages.tree.emptySpace}</p> : null;
  }
  return (
    <>
      {nodes.map((node, index) => (
        <EntityNode
          key={node.id}
          node={node}
          space={space}
          parentId={parentId}
          level={level}
          ancestors={ancestors}
          lastInGroup={index === nodes.length - 1}
          prevId={nodes[index - 1]?.id ?? null}
          nextId={nodes[index + 1]?.id ?? null}
        />
      ))}
    </>
  );
}

function EntityNode({
  node,
  space,
  parentId,
  level,
  ancestors,
  lastInGroup,
  prevId,
  nextId,
}: {
  node: TreeNode;
  space: SpaceSummary;
  parentId: string | null;
  level: number;
  ancestors: readonly { id: string; parentId: string | null }[];
  lastInGroup: boolean;
  prevId: string | null;
  nextId: string | null;
}) {
  const tree = useTree();
  const rowRef = useRef<HTMLDivElement>(null);
  const [iconOpen, setIconOpen] = useState(false);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const expanded = tree.isExpanded(node.id);
  const renaming = tree.renamingId === node.id;
  const menuOpen = tree.menuId === node.id;
  const untitled = node.title === '';
  const href = `/s/${space.slug}/p/${node.id}`;
  const source = { entityId: node.id, spaceId: space.id, parentId };
  const target = { kind: 'entity' as const, entityId: node.id, spaceId: space.id, parentId, level, ancestors };
  const mode = expanded && node.hasChildren ? 'expanded' : lastInGroup ? 'last-in-group' : 'standard';
  const visual = tree.drop?.id === node.id ? dropVisual(tree.drop.instruction) : { dropState: null, dropIndentPx: 0 };

  useTreeDnd({
    rowRef,
    draggable: !renaming,
    source,
    target,
    level,
    mode,
    expandable: node.hasChildren,
    expanded,
    onHoverExpand: () => tree.expand(node.id),
    onInstruction: (instruction) => tree.setDrop(instruction === null ? null : { id: node.id, instruction }),
    onDrop: (instruction, drag) => {
      const input = instructionToMove(instruction, drag, target);
      if (input !== null) void tree.move(input, drag, { spaceId: target.spaceId, parentId: target.parentId });
    },
    onDraggingChange: (dragging) => tree.setDraggingId(dragging ? node.id : null),
  });

  async function saveRename(next: string): Promise<void> {
    tree.setRenamingId(null);
    const title = next.trim();
    if (title === node.title) return;
    try {
      await renamePageFn({ data: { entityId: node.id, title } });
      tree.store.invalidate([branchKey(space.id, parentId)]);
    } catch {
      // Keep the previous title; the branch still has it.
    }
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (renaming) event.stopPropagation();
  }

  return (
    <TreeRow
      id={node.id}
      level={level}
      label={
        renaming ? (
          <RenameInput
            title={node.title}
            onCommit={(next) => void saveRename(next)}
            onCancel={() => tree.setRenamingId(null)}
          />
        ) : untitled ? (
          messages.tree.untitled
        ) : (
          node.title
        )
      }
      icon={node.icon ?? <FileTextIcon aria-hidden="true" size={18} />}
      expandable={node.hasChildren}
      expanded={expanded}
      selected={tree.selectedId === node.id}
      tabIndex={tree.focusedId === node.id ? 0 : -1}
      muted={untitled}
      dragging={tree.draggingId === node.id}
      flash={tree.flashId === node.id}
      leaving={tree.isLeaving(node.id)}
      menuOpen={menuOpen || newPageOpen || iconOpen}
      dropState={visual.dropState}
      dropIndentPx={visual.dropIndentPx}
      rowRef={rowRef}
      onToggle={() => tree.toggle(node.id)}
      onKeyDown={onRowKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        tree.setMenuId(node.id);
      }}
      {...(renaming ? {} : { href })}
      actions={
        <>
          <EmojiField
            value={node.icon}
            hideTrigger
            open={iconOpen}
            onOpenChange={setIconOpen}
            isValid={isSingleEmoji}
            labels={messages.icon}
            onChange={(next) => {
              void setIconFn({ data: { entityId: node.id, icon: next } }).then(() =>
                tree.store.invalidate([branchKey(space.id, parentId)]),
              );
            }}
          />
          <NewPageMenu
            spaceId={space.id}
            parentId={node.id}
            open={newPageOpen}
            onOpenChange={setNewPageOpen}
            trigger={
              <RowIconButton label={messages.tree.newPage}>
                <PlusIcon aria-hidden="true" size={16} />
              </RowIconButton>
            }
            onCreated={() => tree.createdPage(space.id, node.id, parentId)}
          />
          <RowMenu open={menuOpen} onOpenChange={(open) => tree.setMenuId(open ? node.id : null)} label={messages.tree.options}>
            <RowMenuItem onSelect={() => tree.setRenamingId(node.id)}>{messages.tree.rename}</RowMenuItem>
            <RowMenuItem onSelect={() => setIconOpen(true)}>{messages.icon.trigger}</RowMenuItem>
            <RowMenuItem onSelect={() => void tree.setStarred(node.id, !node.isStarred, space.id, parentId)}>
              {node.isStarred ? messages.favorites.remove : messages.favorites.add}
            </RowMenuItem>
            <RowMenuItem onSelect={() => tree.openMove({ id: node.id, title: node.title, spaceId: space.id, parentId })}>
              {messages.tree.moveTo}
            </RowMenuItem>
            <RowMenuItem disabled={prevId === null} onSelect={() => void tree.moveRelative(node.id, space.id, parentId, 'up', prevId, nextId)}>
              {messages.tree.moveUp}
            </RowMenuItem>
            <RowMenuItem disabled={nextId === null} onSelect={() => void tree.moveRelative(node.id, space.id, parentId, 'down', prevId, nextId)}>
              {messages.tree.moveDown}
            </RowMenuItem>
            <RowMenuSeparator />
            <RowMenuItem danger onSelect={() => void tree.trash({ id: node.id, title: node.title, spaceId: space.id, parentId, animate: true })}>
              {messages.tree.moveToTrash}
            </RowMenuItem>
          </RowMenu>
        </>
      }
    >
      {expanded && node.hasChildren ? (
        <EntityList
          space={space}
          parentId={node.id}
          level={level + 1}
          ancestors={[...ancestors, { id: node.id, parentId }]}
        />
      ) : null}
    </TreeRow>
  );
}
