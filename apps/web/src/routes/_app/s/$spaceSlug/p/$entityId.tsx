import { PageEditor, TitleInput } from '@archlin/modules-knowledge/web';
import { toast } from '@archlin/ui/components/sonner';
import { createFileRoute, notFound, redirect, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { MoveDialog } from '~/components/move-dialog';
import { PageMenu } from '~/components/page-menu';
import { PageTopBar } from '~/components/page-top-bar';
import { TrashBanner } from '~/components/trash-banner';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { formatRelative } from '~/lib/format-time';
import { readExpanded, writeExpanded } from '~/lib/tree-expanded';
import { notifyTreeMutation } from '~/lib/tree-sync';
import { AppError } from '~/server/errors';
import { pageFn } from '~/server/functions/pages';
import { listSpacesFn } from '~/server/functions/spaces';
import { restoreFn } from '~/server/functions/trash';
import { setStarredFn, trashEntityFn } from '~/server/functions/tree';

export const Route = createFileRoute('/_app/s/$spaceSlug/p/$entityId')({
  loader: async ({ params }) => {
    try {
      const { page, breadcrumbs } = await pageFn({ data: { entityId: params.entityId } });
      if (params.spaceSlug !== page.spaceSlug) {
        throw redirect({
          to: '/s/$spaceSlug/p/$entityId',
          params: { spaceSlug: page.spaceSlug, entityId: params.entityId },
          replace: true,
        });
      }
      const spaces = await listSpacesFn({ data: { includeArchived: true } });
      const space = spaces.find((row) => row.id === page.spaceId);
      return {
        page,
        breadcrumbs,
        spaces,
        spaceName: space?.name ?? page.spaceSlug,
        mobileTitle: page.title || messages.page.untitled,
        nowIso: new Date().toISOString(),
      };
    } catch (error) {
      // pageFn maps a missing id to 404; notFound() is what renders the M0 empty-search screen.
      if (error instanceof AppError && error.status === 404) throw notFound();
      throw error;
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData === undefined
            ? messages.appName
            : `${loaderData.page.title || messages.page.untitled} · ${messages.appName}`,
      },
    ],
  }),
  component: PageScreen,
});

function PageScreen() {
  const { page, breadcrumbs, spaces, spaceName, nowIso } = Route.useLoaderData();
  const router = useRouter();
  const [moving, setMoving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [title, setTitle] = useState(page.title);
  const focusEditor = useRef<(() => void) | null>(null);
  const now = new Date(nowIso);
  const readOnly = page.deletedAt !== null;
  const parentId = breadcrumbs.at(-1)?.id ?? null;
  const moveSpaces = spaces.filter((row) => row.archivedAt === null || row.id === page.spaceId);

  useEffect(() => {
    const next = new Set(readExpanded());
    let changed = false;
    for (const crumb of breadcrumbs) {
      if (next.has(crumb.id)) continue;
      next.add(crumb.id);
      changed = true;
    }
    if (changed) writeExpanded(next);
  }, [breadcrumbs]);

  async function run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const presentation = messageForError(error);
      if (presentation.kind === 'toast') toast.error(presentation.text);
    }
  }

  function toggleStar(): void {
    void run(async () => {
      await setStarredFn({ data: { entityId: page.entityId, starred: !page.isStarred } });
      notifyTreeMutation();
      await router.invalidate();
    });
  }

  function trash(): void {
    void run(async () => {
      await trashEntityFn({ data: { entityId: page.entityId } });
      notifyTreeMutation();
      await router.invalidate();
    });
  }

  function restore(): void {
    const rootId = page.trashRootId;
    if (rootId === null || restoring) return;
    setRestoring(true);
    void run(async () => {
      await restoreFn({ data: { rootId } });
      notifyTreeMutation();
      await router.invalidate();
      toast(messages.page.restored);
    }).finally(() => setRestoring(false));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageTopBar
        breadcrumbs={breadcrumbs}
        spaceName={spaceName}
        spaceSlug={page.spaceSlug}
        title={page.title}
        saveState="idle"
        isStarred={page.isStarred}
        onToggleStar={toggleStar}
        menu={
          <PageMenu
            entityId={page.entityId}
            version={page.version}
            noteTypeId={page.noteType.id}
            onMove={() => setMoving(true)}
            onTrash={trash}
            onTypeChanged={() => void router.invalidate()}
          />
        }
      />
      <div key={page.entityId} className="page-enter flex flex-1 flex-col px-4 pt-10 pb-10 nav:pt-14">
        <div className="mx-auto w-full max-w-[720px]">
          {page.deletedAt === null ? null : <TrashBanner busy={restoring} onRestore={restore} />}
          <TitleInput
            value={title}
            onChange={setTitle}
            onEnter={() => focusEditor.current?.()}
            labels={messages.editor}
            readOnly={readOnly}
          />
          <p className="mt-1.5 text-small text-fg-muted">
            {page.noteType.name} · {messages.page.edited(formatRelative(new Date(page.updatedAt), now))}
          </p>
          <div className="mt-8">
            <PageEditor
              content={page.content}
              editable={!readOnly}
              labels={messages.editor}
              onChange={() => {
                // Body edits live in the editor until save is connected.
              }}
              onEditorReady={(editor) => {
                focusEditor.current = () => {
                  editor.commands.focus('start');
                };
              }}
            />
          </div>
        </div>
      </div>
      <MoveDialog
        entity={moving ? { id: page.entityId, title: page.title, spaceId: page.spaceId, parentId } : null}
        spaces={moveSpaces}
        onOpenChange={(open) => {
          if (!open) setMoving(false);
        }}
        onMoved={() => {
          setMoving(false);
          notifyTreeMutation();
          void router.invalidate();
        }}
      />
    </div>
  );
}
