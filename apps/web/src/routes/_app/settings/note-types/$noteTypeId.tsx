import { NoteTypeEditor } from '@archlin/modules-knowledge/web';
import { Button } from '@archlin/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@archlin/ui/components/dialog';
import { ArrowLeftIcon } from '@phosphor-icons/react/ssr';
import { createFileRoute, Link, notFound, useBlocker, useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { messages } from '~/i18n/id';
import { AppError } from '~/server/errors';
import { noteTypeFn, noteTypesFn } from '~/server/functions/note-types';

export const Route = createFileRoute('/_app/settings/note-types/$noteTypeId')({
  loader: async ({ params }) => {
    try {
      const [detail, types] = await Promise.all([
        noteTypeFn({ data: { id: params.noteTypeId } }),
        noteTypesFn({ data: {} }),
      ]);
      return {
        detail,
        others: types.filter((type) => type.id !== detail.id),
        mobileTitle: detail.name,
      };
    } catch (error) {
      // A malformed id fails validation before the lookup, which is still "no such type" to the reader.
      if (error instanceof AppError && (error.status === 404 || error.status === 422)) throw notFound();
      throw error;
    }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.detail.name ?? messages.noteTypes.title} · ${messages.appName}` }],
  }),
  component: NoteTypePage,
});

function NoteTypePage() {
  const { detail, others } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const leavingForDelete = useRef(false);
  const copy = messages.noteTypes;

  const changeDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirty(next);
  }, []);
  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current && !leavingForDelete.current,
    enableBeforeUnload: () => dirtyRef.current && !leavingForDelete.current,
    withResolver: true,
  });

  return (
    <div className="px-4 py-6 md:p-12">
      <div className="flex max-w-[760px] flex-col gap-6">
        <Link
          to="/settings/note-types"
          className="inline-flex items-center gap-2 self-start rounded-sm text-small text-fg-muted hover:text-fg"
        >
          <ArrowLeftIcon aria-hidden="true" size={16} />
          {copy.editor.back}
        </Link>
        <h1 className="sr-only">{detail.name}</h1>
        <NoteTypeEditor
          key={`${detail.id}:${detail.revision}`}
          detail={detail}
          others={others}
          labels={copy}
          editorLabels={messages.editor}
          iconLabels={messages.icon}
          onDirtyChange={changeDirty}
          onRefresh={() => router.invalidate()}
          onDeleted={() => {
            leavingForDelete.current = true;
            void navigate({ to: '/settings/note-types' });
          }}
        />
      </div>
      <Dialog open={dirty && blocker.status === 'blocked'} onOpenChange={(open) => (open ? undefined : blocker.reset?.())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.leaveTitle}</DialogTitle>
            <DialogDescription>{copy.leaveBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              {copy.leaveStay}
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              {copy.leaveDiscard}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
