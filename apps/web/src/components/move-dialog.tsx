import { Button } from '@archlin/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@archlin/ui/components/dialog';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { NativeSelect } from '@archlin/ui/components/native-select';
import { CaretRightIcon, FileTextIcon, FolderSimpleIcon } from '@phosphor-icons/react/ssr';
import type { SpaceSummary, TreeNode } from '@archlin/platform/contracts';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { messages } from '~/i18n/id';
import { AppError } from '~/server/errors';
import { moveEntityFn, treeChildrenFn } from '~/server/functions/tree';
import { cn } from '@archlin/ui/lib/utils';

export interface MoveEntity {
  id: string;
  title: string;
  spaceId: string;
  parentId: string | null;
}

function treeError(error: unknown): string {
  if (error instanceof AppError && error.code in messages.tree.errors) {
    return messages.tree.errors[error.code as keyof typeof messages.tree.errors];
  }
  return error instanceof AppError ? error.message : messages.errors.offline;
}

function PickerBranch({
  spaceId,
  parentId,
  level,
  blocked,
  selectedId,
  onSelect,
  expanded,
  toggle,
  ancestorBlocked = false,
}: {
  spaceId: string;
  parentId: string | null;
  level: number;
  blocked: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string | null, listingParentId: string | null) => void;
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
  ancestorBlocked?: boolean;
}) {
  const [nodes, setNodes] = useState<TreeNode[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void treeChildrenFn({ data: { spaceId, parentId } }).then(
      (rows) => {
        if (!cancelled) setNodes(rows);
      },
      () => {
        if (!cancelled) setNodes([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [spaceId, parentId]);

  if (nodes === null) return null;

  return (
    <>
      {nodes.map((node) => {
        const disabled = ancestorBlocked || blocked.has(node.id);
        const open = expanded.has(node.id);
        return (
          <div key={node.id}>
            <div
              role="treeitem"
              aria-level={level}
              aria-selected={selectedId === node.id}
              aria-disabled={disabled || undefined}
              aria-expanded={node.hasChildren ? open : undefined}
              className={cn(
                'flex h-[30px] items-center gap-1 rounded-sm pr-2 text-small',
                selectedId === node.id && !disabled ? 'bg-selected text-fg' : 'text-fg-secondary',
                disabled && 'text-fg-disabled',
              )}
              style={{ paddingLeft: 8 + 14 * (level - 1) }}
              onClick={() => {
                if (!disabled) onSelect(node.id, parentId);
              }}
            >
              {node.hasChildren ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="flex size-4 items-center justify-center"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(node.id);
                  }}
                >
                  <CaretRightIcon
                    aria-hidden="true"
                    size={12}
                    className={cn('transition-transform duration-200 ease-out motion-reduce:transition-none', open && 'rotate-90')}
                  />
                </button>
              ) : (
                <span className="w-4" />
              )}
              <span className="flex size-4 items-center justify-center">
                {node.icon ?? <FileTextIcon aria-hidden="true" size={14} />}
              </span>
              <span className="min-w-0 flex-1 truncate">{node.title === '' ? messages.tree.untitled : node.title}</span>
            </div>
            {open && node.hasChildren ? (
              <PickerBranch
                spaceId={spaceId}
                parentId={node.id}
                level={level + 1}
                blocked={blocked}
                selectedId={selectedId}
                onSelect={onSelect}
                expanded={expanded}
                toggle={toggle}
                ancestorBlocked={disabled}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function MoveDialogForm({
  entity,
  spaces,
  onMoved,
  onOpenChange,
}: {
  entity: MoveEntity;
  spaces: readonly SpaceSummary[];
  onMoved: (dest: { spaceId: string; parentId: string | null; listingParentId: string | null }) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [spaceId, setSpaceId] = useState(entity.spaceId);
  const [parentId, setParentId] = useState<string | null>(null);
  const [listingParentId, setListingParentId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<'last' | 'first'>('last');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const blocked = new Set([entity.id]);
  const title = entity.title === '' ? messages.tree.untitled : entity.title;

  function toggle(id: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const siblings = await treeChildrenFn({ data: { spaceId, parentId } });
      const first = siblings.find((row) => row.id !== entity.id);
      await moveEntityFn({
        data: {
          entityId: entity.id,
          targetSpaceId: spaceId,
          newParentId: parentId,
          beforeId: placement === 'first' ? (first?.id ?? null) : null,
          afterId: null,
        },
      });
      onMoved({ spaceId, parentId, listingParentId });
      onOpenChange(false);
    } catch (err) {
      setError(treeError(err));
    } finally {
      setPending(false);
    }
  }

  return (
        <form onSubmit={(event) => void submit(event)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{messages.move.title(title)}</DialogTitle>
          </DialogHeader>
          <label className="flex flex-col gap-2">
            <span className="text-small font-medium text-fg">{messages.move.space}</span>
            <NativeSelect
              value={spaceId}
              onChange={(event) => {
                setSpaceId(event.target.value);
                setParentId(null);
                setListingParentId(null);
                setExpanded(new Set());
              }}
            >
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div role="tree" aria-label={messages.tree.label} className="max-h-56 overflow-y-auto rounded-md border border-line-subtle p-1">
            <div
              role="treeitem"
              aria-level={1}
              aria-selected={parentId === null}
              className={cn(
                'flex h-[30px] items-center gap-1 rounded-sm px-2 text-small',
                parentId === null ? 'bg-selected text-fg' : 'text-fg-secondary',
              )}
              onClick={() => {
                setParentId(null);
                setListingParentId(null);
              }}
            >
              <FolderSimpleIcon aria-hidden="true" size={14} />
              {messages.move.root}
            </div>
            {spaceId === '' ? null : (
              <PickerBranch
                key={spaceId}
                spaceId={spaceId}
                parentId={null}
                level={2}
                blocked={blocked}
                selectedId={parentId}
                onSelect={(id, listing) => {
                  setParentId(id);
                  setListingParentId(listing);
                }}
                expanded={expanded}
                toggle={toggle}
              />
            )}
          </div>
          <fieldset className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-small text-fg-secondary">
              <input
                type="radio"
                name="move-placement"
                checked={placement === 'last'}
                onChange={() => setPlacement('last')}
              />
              {messages.move.atEnd}
            </label>
            <label className="flex items-center gap-2 text-small text-fg-secondary">
              <input
                type="radio"
                name="move-placement"
                checked={placement === 'first'}
                onChange={() => setPlacement('first')}
              />
              {messages.move.atStart}
            </label>
          </fieldset>
          {error === null ? null : <InlineStatus variant="danger">{error}</InlineStatus>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{messages.common.cancel}</Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              {messages.move.submit}
            </Button>
          </DialogFooter>
        </form>
  );
}

export function MoveDialog({
  entity,
  spaces,
  onMoved,
  onOpenChange,
}: {
  entity: MoveEntity | null;
  spaces: readonly SpaceSummary[];
  onMoved: (dest: { spaceId: string; parentId: string | null; listingParentId: string | null }) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={entity !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {entity === null ? null : (
          <MoveDialogForm key={entity.id} entity={entity} spaces={spaces} onMoved={onMoved} onOpenChange={onOpenChange} />
        )}
      </DialogContent>
    </Dialog>
  );
}
