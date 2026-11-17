import type { PageScreen, PageView } from '@archlin/modules-knowledge/shared';
import {
  browserStorage,
  ConflictDialog,
  ContextCard,
  AttachmentsPanel,
  createAttachmentStore,
  createLinkTargetStore,
  createUploadQueue,
  HistoryMain,
  HistoryPanel,
  DraftBanner,
  invalidReason,
  leaveSnapshotAllowed,
  MentionedIn,
  PageEditor,
  removeDraft,
  SaveVersionDialog,
  TitleInput,
  useDraftQueue,
  useKnowledgeClient,
  usePageAutosave,
  useVersionHistory,
} from '@archlin/modules-knowledge/web';
import type { PageEditorAttachments, PageEditorLinks } from '@archlin/modules-knowledge/web';
import type { Breadcrumb, SpaceSummary, TagRef } from '@archlin/platform/contracts';
import { Button } from '@archlin/ui/components/button';
import { toast } from '@archlin/ui/components/sonner';
import { createFileRoute, notFound, redirect, useBlocker, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoveDialog } from '~/components/move-dialog';
import { PageMenu } from '~/components/page-menu';
import { PageTopBar } from '~/components/page-top-bar';
import { TrashBanner } from '~/components/trash-banner';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { formatRelative, formatVersionTime } from '~/lib/format-time';
import { readExpanded, writeExpanded } from '~/lib/tree-expanded';
import { usePanelLayout } from '~/lib/use-docked-layout';
import { notifyTreeMutation, subscribePageChanged } from '~/lib/tree-sync';
import { AppError } from '~/server/errors';
import { pageFn } from '~/server/functions/pages';
import { listSpacesFn } from '~/server/functions/spaces';
import { restoreFn } from '~/server/functions/trash';
import { setStarredFn, trashEntityFn } from '~/server/functions/tree';

const UNSAVED = new Set(['dirty', 'saving', 'error', 'offline', 'conflict', 'invalid', 'signedOut', 'tooLarge']);

export const Route = createFileRoute('/_app/s/$spaceSlug/p/$entityId')({
  loader: async ({ params, cause }) => {
    try {
      const { page, breadcrumbs, linkTargets, backlinks, attachments } = await pageFn({ data: { entityId: params.entityId, recordView: cause === 'enter' } });
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
        linkTargets,
        backlinks,
        attachments,
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
  const data = Route.useLoaderData();
  return <PageBody key={data.page.entityId} {...data} />;
}

function PageBody({
  page,
  breadcrumbs,
  linkTargets,
  backlinks,
  attachments,
  spaces,
  spaceName,
  nowIso,
}: {
  page: PageView;
  breadcrumbs: readonly Breadcrumb[];
  linkTargets: PageScreen['linkTargets'];
  backlinks: PageScreen['backlinks'];
  attachments: PageScreen['attachments'];
  spaces: readonly SpaceSummary[];
  spaceName: string;
  nowIso: string;
}) {
  const router = useRouter();
  const client = useKnowledgeClient();
  const autosave = usePageAutosave({ page, client });
  const { adoptServer } = autosave;
  const [moving, setMoving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [dismissedConflict, setDismissedConflict] = useState(false);
  const [seenConflictVersion, setSeenConflictVersion] = useState<number | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [versionListOpen, setVersionListOpen] = useState(true);
  const [saveVersionOpen, setSaveVersionOpen] = useState(false);
  const [historyReload, setHistoryReload] = useState(0);
  const panelLayout = usePanelLayout();
  const [tagState, setTagState] = useState<{ source: TagRef[]; tags: TagRef[] }>({ source: page.tags, tags: page.tags });
  const [linkStore] = useState(() => createLinkTargetStore(linkTargets));
  const [attachmentStore] = useState(() => createAttachmentStore(attachments));
  const [liveSince] = useState(() => new Date().toISOString());
  const { drafts: draftQueue, refresh: refreshDrafts } = useDraftQueue(page, liveSince);
  const lastTreeTitle = useRef(page.title);
  const focusEditor = useRef<(() => void) | null>(null);
  const insertAtEnd = useRef<((files: File[]) => void) | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const flushRef = useRef(autosave.flush);
  const statusRef = useRef(autosave.state.status);
  const trashedRef = useRef(false);
  const now = new Date(nowIso);
  const inConflict = autosave.state.status === 'conflict';
  const conflictVersion = autosave.state.conflictVersion;
  const trashed = page.deletedAt !== null || autosave.state.status === 'trashed';
  const readOnly = trashed;
  const parentId = breadcrumbs.at(-1)?.id ?? null;
  const moveSpaces = spaces.filter((row) => row.archivedAt === null || row.id === page.spaceId);
  const pendingDraft = draftQueue[0];

  // A reloaded page carries the server tags, which win over what this view last saved.
  if (tagState.source !== page.tags) setTagState({ source: page.tags, tags: page.tags });

  if (inConflict) {
    if (seenConflictVersion === null && conflictVersion !== null) setSeenConflictVersion(conflictVersion);
  } else if (dismissedConflict || seenConflictVersion !== null) {
    setDismissedConflict(false);
    setSeenConflictVersion(null);
  }

  const conflictOpen = inConflict && !dismissedConflict;
  const changedAgain = inConflict && seenConflictVersion !== null && conflictVersion !== seenConflictVersion;

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

  useEffect(() => {
    flushRef.current = autosave.flush;
    statusRef.current = autosave.state.status;
    trashedRef.current = trashed;
  }, [autosave.flush, autosave.state.status, trashed]);

  useEffect(() => {
    if (autosave.state.status !== 'saved') return;
    if (autosave.state.latest.title === lastTreeTitle.current) return;
    lastTreeTitle.current = autosave.state.latest.title;
    notifyTreeMutation();
  }, [autosave.state.status, autosave.state.latest.title]);

  useEffect(() => {
    adoptServer(page);
  }, [adoptServer, page]);

  useEffect(() => {
    if (autosave.state.status !== 'trashed' || page.deletedAt !== null) return;
    void router.invalidate();
  }, [autosave.state.status, page.deletedAt, router]);

  useEffect(
    () =>
      subscribePageChanged((entityId) => {
        if (entityId === page.entityId) void router.invalidate();
      }),
    [page.entityId, router],
  );

  useEffect(() => {
    linkStore.replace(linkTargets);
  }, [linkStore, linkTargets]);

  useEffect(() => {
    attachmentStore.replace(attachments);
  }, [attachmentStore, attachments]);

  // One queue per open page: it is created once so a retry still finds the job that failed.
  const [uploadQueue] = useState(() =>
    createUploadQueue({
      concurrency: 2,
      run: async (job, onProgress, signal) =>
        (await client.uploadFile({ pageId: page.entityId, uploadId: job.uploadId, file: job.file }, onProgress, signal)).attachment,
    }),
  );
  const pageAttachments = useMemo<PageEditorAttachments>(
    () => ({
      pageId: page.entityId,
      store: attachmentStore,
      queue: uploadQueue,
      copy: async (ids) => {
        // The server copies at most 50 at a time.
        const copied: Record<string, string> = {};
        for (let from = 0; from < ids.length; from += 50) {
          Object.assign(copied, await client.copyAttachments({ pageId: page.entityId, attachmentIds: ids.slice(from, from + 50) }));
        }
        return copied;
      },
      refresh: async () => attachmentStore.replace(await client.listAttachments(page.entityId)),
    }),
    [attachmentStore, client, page.entityId, uploadQueue],
  );

  const links = useMemo<PageEditorLinks>(
    () => ({
      store: linkStore,
      entityId: page.entityId,
      spaceId: page.spaceId,
      spaceSlug: page.spaceSlug,
      client,
      navigate: (href) => {
        void router.navigate({ href });
      },
      createLinkedPage: async (title) => {
        try {
          const created = await client.createLinkedPage({ sourceEntityId: page.entityId, title });
          notifyTreeMutation();
          return created;
        } catch (error) {
          const presentation = messageForError(error);
          if (presentation.kind === 'toast') toast.error(presentation.text);
          throw error;
        }
      },
    }),
    [linkStore, page.entityId, page.spaceId, page.spaceSlug, client, router],
  );

  const flush = autosave.flush;
  const prepareTypeChange = useCallback(async (): Promise<number | null> => {
    const settled = await flush();
    return settled.status === 'idle' || settled.status === 'saved' ? settled.baseVersion : null;
  }, [flush]);

  const history = useVersionHistory({
    entityId: page.entityId,
    open: historyOpen,
    reloadToken: historyReload,
    prepare: prepareTypeChange,
    onRestored: () => {
      notifyTreeMutation();
      setEditorKey((key) => key + 1);
      void router.invalidate();
      toast(messages.history.restored);
    },
    onError: (error) => {
      const presentation = messageForError(error);
      if (presentation.kind === 'toast') toast.error(presentation.text);
    },
    labels: messages.history,
  });

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatTime = useCallback((iso: string) => formatVersionTime(new Date(iso), new Date(), timeZone), [timeZone]);

  const saveVersion = useCallback(
    async (label: string | null): Promise<boolean> => {
      const base = await prepareTypeChange();
      if (base === null) {
        toast(messages.history.unsavedFirst);
        return false;
      }
      try {
        const result = await client.snapshotPage({ entityId: page.entityId, reason: 'manual', label });
        toast(
          result.status === 'created' ? messages.history.saved : result.status === 'kept' ? messages.history.kept : messages.history.unchanged,
        );
        setHistoryReload((value) => value + 1);
        return true;
      } catch (error) {
        const presentation = messageForError(error);
        if (presentation.kind === 'toast') toast.error(presentation.text);
        return false;
      }
    },
    [client, page.entityId, prepareTypeChange],
  );

  // History and attachments share the side column and the sheet, so opening one closes the other.
  function openHistory(): void {
    setAttachmentsOpen(false);
    setVersionListOpen(true);
    setHistoryOpen(true);
  }

  async function duplicate(): Promise<void> {
    const base = await prepareTypeChange();
    if (base === null) {
      toast(messages.history.unsavedFirst);
      return;
    }
    try {
      const copy = await client.duplicatePage({ entityId: page.entityId, rootTitle: messages.page.copyTitle(autosave.state.latest.title) });
      notifyTreeMutation();
      void router.navigate({ to: '/s/$spaceSlug/p/$entityId', params: { spaceSlug: copy.spaceSlug, entityId: copy.entityId } });
      toast(messages.page.duplicated(copy.count));
    } catch (error) {
      const presentation = messageForError(error);
      if (presentation.kind === 'toast') toast.error(presentation.text);
    }
  }

  function openAttachments(): void {
    setHistoryOpen(false);
    setAttachmentsOpen(true);
  }

  // New files go to the end of the content, so each one is referenced by a card as soon as it lands.
  function uploadFromPanel(files: File[]): void {
    insertAtEnd.current?.(files);
  }

  const shouldBlockFn = useCallback(async () => {
    const settled = await flushRef.current();
    // A failed snapshot never holds the navigation back; the idle policy covers what a leave misses.
    if (leaveSnapshotAllowed(settled.status, trashedRef.current)) {
      client.snapshotPage({ entityId: page.entityId, reason: 'leave', label: null }).catch(() => {
        toast.error(messages.history.leaveFailed);
      });
    }
    return false;
  }, [client, page.entityId]);
  const enableBeforeUnload = useCallback(() => UNSAVED.has(statusRef.current), []);
  useBlocker({ shouldBlockFn, enableBeforeUnload });

  async function run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const presentation = messageForError(error);
      if (presentation.kind === 'toast') toast.error(presentation.text);
    }
  }

  const changeTags = useCallback(
    async (names: string[]): Promise<void> => {
      const saved = await client.setTags(page.entityId, names);
      setTagState((current) => ({ source: current.source, tags: saved }));
    },
    [client, page.entityId],
  );

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

  function restorePending(): void {
    if (pendingDraft === undefined) return;
    autosave.restoreDraft(pendingDraft);
    const storage = browserStorage();
    if (storage !== null) removeDraft(storage, pendingDraft.entityId, pendingDraft.tabId);
    refreshDrafts();
    setEditorKey((key) => key + 1);
  }

  function discardPending(): void {
    if (pendingDraft === undefined) return;
    const storage = browserStorage();
    if (storage !== null) removeDraft(storage, pendingDraft.entityId, pendingDraft.tabId);
    refreshDrafts();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageTopBar
        breadcrumbs={breadcrumbs}
        spaceName={spaceName}
        spaceSlug={page.spaceSlug}
        title={autosave.state.latest.title}
        saveState={autosave.saveStatus}
        invalidReason={invalidReason(autosave.state.issues)}
        saveAction={
          autosave.saveStatus === 'conflict' ? (
            <Button variant="ghost" size="row" onClick={() => setDismissedConflict(false)}>
              {messages.page.resolveConflict}
            </Button>
          ) : autosave.saveStatus === 'signedOut' ? (
            <Button variant="ghost" size="row" onClick={() => void router.navigate({ to: '/login' })}>
              {messages.page.signInAgain}
            </Button>
          ) : null
        }
        isStarred={page.isStarred}
        onToggleStar={toggleStar}
        menu={
          <PageMenu
            entityId={page.entityId}
            prepareTypeChange={prepareTypeChange}
            noteTypeId={page.noteType.id}
            trashed={trashed}
            triggerRef={menuTrigger}
            onOpenAttachments={openAttachments}
            onOpenHistory={openHistory}
            onSaveVersion={() => setSaveVersionOpen(true)}
            onDuplicate={() => void duplicate()}
            onMove={() => setMoving(true)}
            onTrash={trash}
            onTypeChanged={() => void router.invalidate()}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <div key={`${editorKey}:${autosave.adoptedCount}`} className="page-enter flex min-w-0 flex-1 flex-col px-4 pt-10 pb-10 nav:pt-14">
          <div className="mx-auto w-full max-w-[720px]">
            {trashed ? <TrashBanner busy={restoring} onRestore={restore} /> : null}
            {historyOpen ? (
              <HistoryMain
                history={history}
                page={page}
                draft={autosave.state.latest}
                labels={messages.history}
                editorLabels={messages.editor}
                links={links}
                attachments={pageAttachments}
                formatTime={formatTime}
                layout={panelLayout}
                trashed={trashed}
                onShowList={() => setVersionListOpen(true)}
                onClose={() => setHistoryOpen(false)}
              />
            ) : (
              <>
                {pendingDraft === undefined ? null : (
                  <DraftBanner
                    relativeTime={formatRelative(new Date(pendingDraft.updatedAt), now)}
                    onRestore={restorePending}
                    onDiscard={discardPending}
                    labels={{
                      message: messages.page.draftBanner,
                      restore: messages.page.restoreDraft,
                      discard: messages.page.discardDraft,
                    }}
                  />
                )}
                <h1 className="sr-only">{autosave.state.latest.title || messages.page.untitled}</h1>
                <TitleInput
                  value={autosave.state.latest.title}
                  onChange={(title) => autosave.update({ title })}
                  onEnter={() => focusEditor.current?.()}
                  labels={messages.editor}
                  readOnly={readOnly}
                />
                <p className="mt-1.5 text-small text-fg-muted">
                  {page.noteType.name} · {messages.page.edited(formatRelative(new Date(page.updatedAt), now))}
                </p>
                <div className="mt-6">
                  <ContextCard
                    key={`${editorKey}:${autosave.adoptedCount}`}
                    page={page}
                    draft={autosave.state.latest}
                    onChange={autosave.update}
                    tags={tagState.tags}
                    onTagsChange={changeTags}
                    issues={autosave.state.issues}
                    readOnly={readOnly}
                    labels={messages.contextCard}
                  />
                </div>
                <div className="mt-8">
                  <PageEditor
                    key={`${editorKey}:${autosave.adoptedCount}`}
                    content={autosave.state.latest.content}
                    editable={!readOnly}
                    labels={messages.editor}
                    links={links}
                    attachments={pageAttachments}
                    onChange={(content) => autosave.update({ content })}
                    onEditorReady={(editor) => {
                      insertAtEnd.current = (files) => {
                        if (!editor.isDestroyed) editor.commands.insertFiles(files, editor.state.doc.content.size);
                      };
                      focusEditor.current = () => {
                        editor.commands.focus('start');
                      };
                    }}
                  />
                </div>
                <MentionedIn backlinks={backlinks} labels={messages.mentionedIn} navigate={links.navigate} />
              </>
            )}
          </div>
        </div>
        <AttachmentsPanel
          pageId={page.entityId}
          store={attachmentStore}
          open={attachmentsOpen}
          onOpenChange={setAttachmentsOpen}
          onUploadFiles={uploadFromPanel}
          trashed={trashed}
          client={client}
          labels={messages.attachments}
          layout={panelLayout}
          returnFocus={menuTrigger}
        />
        <HistoryPanel
          history={history}
          labels={messages.history}
          trashed={trashed}
          open={historyOpen && (panelLayout === 'docked' || versionListOpen)}
          onOpenChange={(open) => {
            if (open) return;
            if (panelLayout === 'sheet' && history.selectedId !== null) setVersionListOpen(false);
            else setHistoryOpen(false);
          }}
          onSaveVersion={() => setSaveVersionOpen(true)}
          onPicked={() => setVersionListOpen(false)}
          layout={panelLayout}
          returnFocus={menuTrigger}
          formatTime={formatTime}
        />
      </div>
      <SaveVersionDialog open={saveVersionOpen} onOpenChange={setSaveVersionOpen} onSave={saveVersion} labels={messages.history} />
      <MoveDialog
        entity={moving ? { id: page.entityId, title: autosave.state.latest.title, spaceId: page.spaceId, parentId } : null}
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
      <ConflictDialog
        open={conflictOpen}
        onOpenChange={(open) => setDismissedConflict(!open)}
        changedAgain={changedAgain}
        onLoadLatest={async () => {
          await autosave.loadLatest();
          setEditorKey((key) => key + 1);
        }}
        onOverwrite={() => autosave.overwrite()}
        labels={{
          title: messages.page.conflictTitle,
          body: messages.page.conflictBody,
          loadLatest: messages.page.loadLatest,
          overwrite: messages.page.overwrite,
          changedAgain: messages.page.conflictAgain,
        }}
      />
    </div>
  );
}
