import type { PageSuggestion } from '@archlin/modules-knowledge/shared';
import { Button } from '@archlin/ui/components/button';
import { Popover, PopoverAnchor, PopoverContent } from '@archlin/ui/components/popover';
import { Skeleton } from '@archlin/ui/components/skeleton';
import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { OpenLinkPopoverDetail } from './wiki-link-view';
import type { LinkLabels, PageEditorLinks } from './page-editor-links';

type Candidates = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; items: PageSuggestion[] };

// Resolves the node at `pos` only if it is still the link the popover was opened for; the text may have moved while it was open.
function resolveNode(editor: Editor, detail: OpenLinkPopoverDetail, target: { entityId: string; title: string }): void {
  const node = editor.state.doc.nodeAt(detail.pos);
  if (node === null || node.type.name !== 'wikiLink' || node.attrs.entityId !== null) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(detail.pos, undefined, target));
}

const titleKey = (title: string): string => title.trim().replace(/\s+/g, ' ').toLowerCase();

// Pages whose title is exactly the link's: the choices of an ambiguous link, or the page an unresolved one already has.
function useExactCandidates(title: string, links: PageEditorLinks): Candidates {
  const [candidates, setCandidates] = useState<Candidates>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    const wanted = titleKey(title);
    links.client
      .suggestPages({ q: title, spaceId: links.spaceId, excludeId: links.entityId })
      .then((rows) => {
        if (current) setCandidates({ status: 'ready', items: rows.filter((row) => titleKey(row.title) === wanted) });
      })
      .catch(() => {
        if (current) setCandidates({ status: 'failed' });
      });
    return () => {
      current = false;
    };
  }, [links, title]);

  return candidates;
}

function Choices({
  candidates,
  labels,
  onPick,
}: {
  candidates: Candidates;
  labels: LinkLabels;
  onPick: (page: PageSuggestion) => void;
}) {
  function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
    const at = options.indexOf(document.activeElement as HTMLElement);
    const next = options[(at + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
  }

  if (candidates.status === 'loading') {
    return (
      <div className="mt-3 grid gap-1.5" aria-hidden="true">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  }
  if (candidates.status === 'failed') return <p className="mt-3 text-small text-fg-muted">{labels.loadFailed}</p>;
  if (candidates.items.length === 0) return <p className="mt-3 text-small text-fg-muted">{labels.empty}</p>;
  return (
    <div role="listbox" className="mt-3 grid gap-0.5" onKeyDown={moveFocus}>
      {candidates.items.map((page) => (
        <button
          key={page.entityId}
          type="button"
          role="option"
          aria-selected="false"
          className="flex h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-small text-fg-secondary hover:bg-selected hover:text-fg focus-visible:bg-selected focus-visible:text-fg"
          onClick={() => onPick(page)}
        >
          {page.icon === null ? null : (
            <span aria-hidden="true" className="w-4 shrink-0 text-center leading-none">
              {page.icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{page.title}</span>
          <span className="shrink-0 text-micro text-fg-muted">{page.spaceName}</span>
        </button>
      ))}
    </div>
  );
}

function PopoverBody({
  detail,
  links,
  labels,
  creating,
  onCreate,
  onPick,
}: {
  detail: OpenLinkPopoverDetail;
  links: PageEditorLinks;
  labels: LinkLabels;
  creating: boolean;
  onCreate: () => void;
  onPick: (page: PageSuggestion) => void;
}) {
  const candidates = useExactCandidates(detail.title, links);
  if (detail.state === 'ambiguous') {
    return (
      <>
        <p className="text-small text-fg-secondary">{labels.ambiguousBody(detail.title)}</p>
        <Choices candidates={candidates} labels={labels} onPick={onPick} />
      </>
    );
  }
  // The server saw no match when the page loaded, but one may exist now (restored from trash, a twin trashed).
  if (candidates.status === 'ready' && candidates.items.length > 0) {
    return (
      <>
        <p className="text-small text-fg-secondary">{labels.existingBody(detail.title)}</p>
        <Choices candidates={candidates} labels={labels} onPick={onPick} />
      </>
    );
  }
  return (
    <>
      <p className="text-small text-fg-secondary">{labels.unresolvedBody(detail.title)}</p>
      <Button className="mt-3" size="row" loading={creating || candidates.status === 'loading'} onClick={onCreate}>
        {labels.createPage}
      </Button>
    </>
  );
}

export function UnresolvedLinkPopover({
  editor,
  links,
  labels,
  detail,
  onClose,
}: {
  editor: Editor | null;
  links: PageEditorLinks;
  labels: LinkLabels;
  detail: OpenLinkPopoverDetail | null;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);

  async function createPage(): Promise<void> {
    if (editor === null || detail === null || creating) return;
    setCreating(true);
    try {
      const created = await links.createLinkedPage(detail.title);
      links.store.set({
        key: created.entityId,
        kind: 'wikilink',
        targetTitle: detail.title,
        target: { id: created.entityId, title: detail.title, icon: null, spaceSlug: created.spaceSlug, trashed: false },
        ambiguous: false,
      });
      resolveNode(editor, detail, { entityId: created.entityId, title: detail.title });
      onClose();
      links.navigate(`/s/${created.spaceSlug}/p/${created.entityId}`);
    } catch {
      // The route's createLinkedPage already toasted the failure; the popover stays open so the user can retry.
    } finally {
      setCreating(false);
    }
  }

  function pick(page: PageSuggestion): void {
    if (editor === null || detail === null) return;
    links.store.set({
      key: page.entityId,
      kind: 'wikilink',
      targetTitle: page.title,
      target: { id: page.entityId, title: page.title, icon: page.icon, spaceSlug: page.spaceSlug, trashed: false },
      ambiguous: false,
    });
    resolveNode(editor, detail, { entityId: page.entityId, title: page.title });
    onClose();
  }

  return (
    <Popover
      open={detail !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {detail === null ? null : <PopoverAnchor virtualRef={{ current: detail.anchor }} />}
      <PopoverContent
        align="start"
        className="w-[min(100vw-2rem,20rem)]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor?.commands.focus();
        }}
      >
        {detail === null ? null : (
          <PopoverBody
            key={`${detail.pos}:${detail.title}`}
            detail={detail}
            links={links}
            labels={labels}
            creating={creating}
            onCreate={() => void createPage()}
            onPick={pick}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
