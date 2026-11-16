import { flushActiveAutosaves } from '@archlin/modules-knowledge/web';
import { Button } from '@archlin/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@archlin/ui/components/dropdown-menu';
import { Skeleton } from '@archlin/ui/components/skeleton';
import { toast } from '@archlin/ui/components/sonner';
import { treeKeyAction, type VisibleRow } from '@archlin/ui/tree/tree-keyboard';
import { useLeaving } from '@archlin/ui/lib/use-leaving';
import type { Instruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';
import type { MoveEntityInput, SpaceSummary } from '@archlin/platform/contracts';
import { DotsThreeIcon, PlusIcon } from '@phosphor-icons/react/ssr';
import { useLocation, useRouter } from '@tanstack/react-router';
import { createContext, use, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { FocusEvent, KeyboardEvent, SyntheticEvent } from 'react';
import { ArchivedSpacesDialog } from '~/components/archived-spaces-dialog';
import { MoveDialog, type MoveEntity } from '~/components/move-dialog';
import { SpaceDialog } from '~/components/space-dialog';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { readExpanded, subscribeExpanded, writeExpanded } from '~/lib/tree-expanded';
import { notifyTreeMutation, subscribeTreeMutation } from '~/lib/tree-sync';
import { branchKey, createTreeStore, type TreeStore } from '~/lib/tree-store';
import { AppError } from '~/server/errors';
import { archiveSpaceFn, listSpacesFn, reorderSpaceFn } from '~/server/functions/spaces';
import { restoreFn } from '~/server/functions/trash';
import { duplicatePageFn } from '~/server/functions/pages';
import { moveEntityFn, setStarredFn, trashEntityFn, treeChildrenFn } from '~/server/functions/tree';
import { SpaceNode } from './space-node';

export interface TreeApi {
  store: TreeStore;
  selectedId: string | null;
  focusedId: string | null;
  flashId: string | null;
  draggingId: string | null;
  menuId: string | null;
  renamingId: string | null;
  drop: { id: string; instruction: Instruction } | null;
  isExpanded: (id: string) => boolean;
  isLeaving: (id: string) => boolean;
  toggle: (id: string) => void;
  expand: (id: string) => void;
  setMenuId: (id: string | null) => void;
  setRenamingId: (id: string | null) => void;
  setDrop: (next: { id: string; instruction: Instruction } | null) => void;
  setDraggingId: (id: string | null) => void;
  move: (
    input: MoveEntityInput,
    from?: { spaceId: string; parentId: string | null },
    destListing?: { spaceId: string; parentId: string | null },
  ) => Promise<void>;
  createdPage: (spaceId: string, parentId: string | null, listingParentId: string | null) => void;
  moveRelative: (
    entityId: string,
    spaceId: string,
    parentId: string | null,
    direction: 'up' | 'down',
    prevId: string | null,
    nextId: string | null,
  ) => Promise<void>;
  reorderSpace: (id: string, direction: 'up' | 'down', prevId: string | null, nextId: string | null) => Promise<void>;
  trash: (input: { id: string; title: string; spaceId: string; parentId: string | null; animate: boolean }) => Promise<void>;
  setStarred: (entityId: string, starred: boolean, spaceId: string, parentId: string | null) => Promise<void>;
  duplicate: (entity: { id: string; title: string; spaceId: string; parentId: string | null }) => Promise<void>;
  archive: (space: SpaceSummary) => Promise<void>;
  openMove: (entity: MoveEntity) => void;
  openRenameSpace: (space: SpaceSummary) => void;
  reloadSpaces: () => void;
}

const TreeContext = createContext<TreeApi | null>(null);

export function useTree(): TreeApi {
  const value = use(TreeContext);
  if (value === null) throw new Error('useTree needs a SpaceTree');
  return value;
}

function treeError(error: unknown): string {
  if (error instanceof AppError && error.code in messages.tree.errors) {
    return messages.tree.errors[error.code as keyof typeof messages.tree.errors];
  }
  const presentation = messageForError(error);
  return presentation.kind === 'toast' ? presentation.text : messages.errors.invalidField;
}

function selectionFromPath(pathname: string, spaces: readonly SpaceSummary[]): { selectedId: string | null; spaceSlug: string | null; entityId: string | null } {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 's' || parts[1] === undefined) return { selectedId: null, spaceSlug: null, entityId: null };
  const slug = parts[1];
  if (parts[2] === 'p' && parts[3] !== undefined) return { selectedId: parts[3], spaceSlug: slug, entityId: parts[3] };
  const space = spaces.find((row) => row.slug === slug);
  return { selectedId: space?.id ?? null, spaceSlug: slug, entityId: null };
}

// The row an event belongs to. Row action buttons and the menus React bubbles out of their portals keep their own keys.
function rowOfEvent(event: SyntheticEvent<HTMLDivElement>): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element) || !event.currentTarget.contains(target)) return null;
  if (target.closest('[data-slot="tree-actions"]') !== null) return null;
  return target.closest<HTMLElement>('[role="treeitem"]');
}

export function SpaceTree() {
  const { pathname } = useLocation();
  const router = useRouter();
  const leaving = useLeaving<string>();
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null);
  const [spacesError, setSpacesError] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; instruction: Instruction } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameSpace, setRenameSpace] = useState<SpaceSummary | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [moving, setMoving] = useState<MoveEntity | null>(null);
  const expanded = useSyncExternalStore(subscribeExpanded, readExpanded, readExpanded);
  const [store] = useState(() => createTreeStore((spaceId, parentId) => treeChildrenFn({ data: { spaceId, parentId } })));
  const spaceList = spaces ?? EMPTY_SPACES;
  const { selectedId, spaceSlug } = selectionFromPath(pathname, spaceList);

  const reloadSpaces = useCallback(() => {
    void listSpacesFn({ data: { includeArchived: false } }).then(
      (rows) => {
        setSpaces(rows);
        setSpacesError(false);
      },
      () => setSpacesError(true),
    );
  }, []);

  useEffect(() => {
    reloadSpaces();
  }, [reloadSpaces]);

  useEffect(() => {
    return subscribeTreeMutation(() => {
      reloadSpaces();
      store.invalidate(store.loadedKeys());
    });
  }, [reloadSpaces, store]);

  useEffect(() => {
    if (spaceSlug === null) return;
    const space = spaceList.find((row) => row.slug === spaceSlug);
    if (space === undefined || readExpanded().has(space.id)) return;
    const next = new Set(readExpanded());
    next.add(space.id);
    writeExpanded(next);
  }, [spaceSlug, spaceList]);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);

  const expand = useCallback((id: string) => {
    const next = new Set(readExpanded());
    next.add(id);
    writeExpanded(next);
  }, []);

  const toggle = useCallback((id: string) => {
    const next = new Set(readExpanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeExpanded(next);
  }, []);

  const collapse = useCallback((id: string) => {
    const next = new Set(readExpanded());
    next.delete(id);
    writeExpanded(next);
  }, []);

  const flash = useCallback((id: string) => {
    setFlashId(id);
    window.setTimeout(() => setFlashId((current) => (current === id ? null : current)), 320);
  }, []);

  const createdPage = useCallback(
    (spaceId: string, parentId: string | null, listingParentId: string | null) => {
      if (parentId !== null) expand(parentId);
      else expand(spaceId);
      const keys = new Set([branchKey(spaceId, parentId)]);
      if (parentId !== null) keys.add(branchKey(spaceId, listingParentId));
      store.invalidate([...keys]);
      notifyTreeMutation();
    },
    [expand, store],
  );

  const move = useCallback(
    async (
      input: MoveEntityInput,
      from?: { spaceId: string; parentId: string | null },
      destListing?: { spaceId: string; parentId: string | null },
    ) => {
      try {
        await moveEntityFn({ data: input });
        const keys = new Set([branchKey(input.targetSpaceId, input.newParentId)]);
        if (from !== undefined) keys.add(branchKey(from.spaceId, from.parentId));
        if (destListing !== undefined) keys.add(branchKey(destListing.spaceId, destListing.parentId));
        store.invalidate([...keys]);
        if (input.newParentId !== null) expand(input.newParentId);
        else expand(input.targetSpaceId);
        flash(input.entityId);
        notifyTreeMutation();
        void router.invalidate();
      } catch (error) {
        toast.error(treeError(error));
      }
    },
    [expand, flash, router, store],
  );

  const api = useMemo<TreeApi>(
    () => ({
      store,
      selectedId,
      focusedId: focusedId ?? selectedId,
      flashId,
      draggingId,
      menuId,
      renamingId,
      drop,
      isExpanded,
      isLeaving: leaving.isLeaving,
      toggle,
      expand,
      setMenuId,
      setRenamingId,
      setDrop,
      setDraggingId,
      move,
      createdPage,
      async moveRelative(entityId, spaceId, parentId, direction, prevId, nextId) {
        const sibling = direction === 'up' ? prevId : nextId;
        if (sibling === null) return;
        await move(
          {
            entityId,
            targetSpaceId: spaceId,
            newParentId: parentId,
            beforeId: direction === 'up' ? sibling : null,
            afterId: direction === 'down' ? sibling : null,
          },
          { spaceId, parentId },
        );
      },
      async reorderSpace(id, direction, prevId, nextId) {
        const sibling = direction === 'up' ? prevId : nextId;
        if (sibling === null) return;
        try {
          await reorderSpaceFn({
            data: { id, beforeId: direction === 'up' ? sibling : null, afterId: direction === 'down' ? sibling : null },
          });
          reloadSpaces();
        } catch (error) {
          toast.error(treeError(error));
        }
      },
      async trash({ id, title, spaceId, parentId, animate }) {
        if (animate) await leaving.leave(id);
        store.drop(branchKey(spaceId, parentId), id);
        try {
          const result = await trashEntityFn({ data: { entityId: id } });
          notifyTreeMutation();
          void router.invalidate();
          const label = title === '' ? messages.tree.untitled : title;
          toast(messages.tree.movedToTrash(label), {
            action: {
              label: messages.tree.undo,
              onClick: () => {
                void restoreFn({ data: { rootId: result.rootId } }).then(
                  () => {
                    notifyTreeMutation();
                    void router.invalidate();
                  },
                  (error: unknown) => toast.error(treeError(error)),
                );
              },
            },
          });
        } catch (error) {
          notifyTreeMutation();
          toast.error(treeError(error));
        }
      },
      async setStarred(id, starred, spaceId, parentId) {
        try {
          await setStarredFn({ data: { entityId: id, starred } });
          store.invalidate([branchKey(spaceId, parentId)]);
          notifyTreeMutation();
          void router.invalidate();
        } catch (error) {
          toast.error(treeError(error));
        }
      },
      async duplicate({ id, title, spaceId, parentId }) {
        try {
          // The open page may hold edits that are not saved yet; the copy should include them.
          await flushActiveAutosaves();
          const copy = await duplicatePageFn({ data: { entityId: id, rootTitle: messages.page.copyTitle(title) } });
          store.invalidate([branchKey(spaceId, parentId)]);
          notifyTreeMutation();
          void router.navigate({ to: '/s/$spaceSlug/p/$entityId', params: { spaceSlug: copy.spaceSlug, entityId: copy.entityId } });
          toast(messages.page.duplicated(copy.count));
        } catch (error) {
          toast.error(treeError(error));
        }
      },
      async archive(space) {
        await leaving.leave(space.id);
        setSpaces((rows) => (rows === null ? rows : rows.filter((row) => row.id !== space.id)));
        try {
          await archiveSpaceFn({ data: { id: space.id } });
          toast(messages.spaces.archivedToast(space.name));
          notifyTreeMutation();
          void router.invalidate();
        } catch (error) {
          toast.error(treeError(error));
          notifyTreeMutation();
        }
      },
      openMove: setMoving,
      openRenameSpace: setRenameSpace,
      reloadSpaces,
    }),
    [
      draggingId,
      drop,
      expand,
      flashId,
      focusedId,
      isExpanded,
      leaving,
      menuId,
      createdPage,
      move,
      reloadSpaces,
      router,
      renamingId,
      selectedId,
      store,
      toggle,
    ],
  );

  function visibleRows(): VisibleRow[] {
    const rows: VisibleRow[] = [];
    const walk = (spaceId: string, parentId: string | null, parentRowId: string, level: number): void => {
      const state = store.branch(branchKey(spaceId, parentId));
      const nodes = state.status === 'idle' ? null : state.nodes;
      if (nodes === null) return;
      for (const node of nodes) {
        const open = expanded.has(node.id);
        rows.push({ id: node.id, level, parentId: parentRowId, expandable: node.hasChildren, expanded: open });
        if (open && node.hasChildren) walk(spaceId, node.id, node.id, level + 1);
      }
    };
    for (const space of spaceList) {
      const open = expanded.has(space.id);
      rows.push({ id: space.id, level: 1, parentId: null, expandable: true, expanded: open });
      if (open) walk(space.id, null, space.id, 2);
    }
    return rows;
  }

  function focusRow(id: string): void {
    setFocusedId(id);
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  function onTreeFocus(event: FocusEvent<HTMLDivElement>): void {
    const row = rowOfEvent(event);
    if (row !== null && row.id !== focusedId) setFocusedId(row.id);
  }

  function onTreeKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (renamingId !== null) return;
    const row = rowOfEvent(event);
    if (row === null) return;
    const rows = visibleRows();
    const action = treeKeyAction(rows, row.id, event.key, { shift: event.shiftKey });
    if (action === null) return;
    event.preventDefault();
    if (action.type === 'focus') focusRow(action.id);
    if (action.type === 'expand') expand(action.id);
    if (action.type === 'collapse') collapse(action.id);
    if (action.type === 'open') document.getElementById(action.id)?.querySelector('a')?.click();
    if (action.type === 'rename') {
      const space = spaceList.find((row) => row.id === action.id);
      if (space !== undefined) setRenameSpace(space);
      else setRenamingId(action.id);
    }
    if (action.type === 'menu') setMenuId(action.id);
    if (action.type === 'trash') {
      const index = rows.findIndex((item) => item.id === action.id);
      const row = rows[index];
      if (row === undefined || row.parentId === null || index < 0) return;
      let spaceId: string | null = null;
      for (let i = index; i >= 0; i -= 1) {
        const candidate = rows[i];
        if (candidate !== undefined && candidate.level === 1) {
          spaceId = candidate.id;
          break;
        }
      }
      if (spaceId === null) return;
      const parentId = row.parentId === spaceId ? null : row.parentId;
      const state = store.branch(branchKey(spaceId, parentId));
      const nodes = state.status === 'idle' ? null : state.nodes;
      const node = nodes?.find((item) => item.id === action.id);
      void api.trash({ id: action.id, title: node?.title ?? '', spaceId, parentId, animate: false });
    }
  }

  return (
    <TreeContext value={api}>
      <div className="flex items-center justify-between px-[14px] pt-7 pb-2.5">
        <span className="text-micro font-medium text-fg-muted">{messages.nav.spaces}</span>
        <span className="flex items-center">
          <Button
            variant="icon"
            size="icon-sm"
            aria-label={messages.spaces.create}
            className="bg-transparent hover:bg-overlay"
            onClick={() => setCreateOpen(true)}
          >
            <PlusIcon aria-hidden="true" size={16} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="icon" size="icon-sm" aria-label={messages.spaces.options} className="bg-transparent hover:bg-overlay">
                <DotsThreeIcon aria-hidden="true" size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setArchivedOpen(true)}>{messages.spaces.archived}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      {spacesError ? (
        <div className="flex flex-col gap-2 px-[14px]">
          <p className="text-small text-fg-muted">{messages.nav.noSpaces}</p>
          <Button variant="secondary" size="row" onClick={reloadSpaces}>
            {messages.common.retry}
          </Button>
        </div>
      ) : spaces === null ? (
        <>
          <SkeletonRows />
        </>
      ) : spaces.length === 0 ? (
        <div className="flex flex-col gap-2 px-[14px]">
          <p className="text-small text-fg-muted">{messages.nav.noSpaces}</p>
          <Button variant="secondary" size="row" onClick={() => setCreateOpen(true)}>
            {messages.spaces.create}
          </Button>
        </div>
      ) : (
        <div role="tree" aria-label={messages.tree.label} className="flex flex-col" onKeyDown={onTreeKeyDown} onFocus={onTreeFocus}>
          {spaces.map((space, index) => (
            <SpaceNode
              key={space.id}
              space={space}
              lastInGroup={index === spaces.length - 1}
              prevId={spaces[index - 1]?.id ?? null}
              nextId={spaces[index + 1]?.id ?? null}
            />
          ))}
        </div>
      )}
      <SpaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onDone={(space) => {
          reloadSpaces();
          expand(space.id);
          router.history.push(`/s/${space.slug}`);
        }}
      />
      <SpaceDialog
        open={renameSpace !== null}
        onOpenChange={(open) => {
          if (!open) setRenameSpace(null);
        }}
        mode="rename"
        {...(renameSpace === undefined || renameSpace === null ? {} : { space: renameSpace })}
        onDone={() => {
          setRenameSpace(null);
          reloadSpaces();
        }}
      />
      <ArchivedSpacesDialog open={archivedOpen} onOpenChange={setArchivedOpen} onRestored={reloadSpaces} />
      <MoveDialog
        entity={moving}
        spaces={spaceList}
        onOpenChange={(open) => {
          if (!open) setMoving(null);
        }}
        onMoved={(dest) => {
          const keys = new Set([branchKey(dest.spaceId, dest.parentId)]);
          if (dest.parentId !== null) keys.add(branchKey(dest.spaceId, dest.listingParentId));
          if (moving !== null) keys.add(branchKey(moving.spaceId, moving.parentId));
          store.invalidate([...keys]);
          if (dest.parentId !== null) expand(dest.parentId);
          else expand(dest.spaceId);
          if (moving !== null) flash(moving.id);
          notifyTreeMutation();
          void router.invalidate();
        }}
      />
    </TreeContext>
  );
}

const EMPTY_SPACES: SpaceSummary[] = [];

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-1 px-[14px]">
      <Skeleton className="h-11" />
      <Skeleton className="h-11" />
    </div>
  );
}
