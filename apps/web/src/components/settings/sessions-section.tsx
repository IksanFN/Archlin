import type { SessionSummary, Viewer } from '@archlin/platform/contracts';
import { Badge } from '@archlin/ui/components/badge';
import { Button } from '@archlin/ui/components/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@archlin/ui/components/dialog';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { Skeleton } from '@archlin/ui/components/skeleton';
import { toast } from '@archlin/ui/components/sonner';
import { useState } from 'react';
import { messages } from '~/i18n/id';
import { messageForError } from '~/lib/client-errors';
import { formatDateTime, formatRelative } from '~/lib/format-time';
import { useAsyncData } from '~/lib/use-async-data';
import { describeUserAgent } from '~/lib/user-agent';
import { revokeOtherSessionsFn, revokeSessionFn, sessionsFn } from '~/server/functions/account';
import { useReauth } from './reauth-dialog';
import { SettingsGroup, SettingsRow } from './settings-row';

const copy = messages.settings.sessions;

const loadSessions = () => sessionsFn({ data: {} });

function reportFailure(failure: unknown): void {
  const presentation = messageForError(failure);
  if (presentation.kind === 'toast') toast.error(presentation.text);
}

export function SessionsSection({ viewer }: { viewer: Viewer }) {
  const { state, reload } = useAsyncData(loadSessions);
  const reauth = useReauth();
  const [target, setTarget] = useState<SessionSummary | null>(null);
  const [pending, setPending] = useState(false);

  async function revoke(session: SessionSummary): Promise<void> {
    setPending(true);
    try {
      await reauth(async () => {
        await revokeSessionFn({ data: { publicId: session.publicId } });
        toast.success(copy.revoked);
        setTarget(null);
        reload();
      });
    } catch (failure) {
      reportFailure(failure);
    } finally {
      setPending(false);
    }
  }

  async function revokeOthers(): Promise<void> {
    setPending(true);
    try {
      await reauth(async () => {
        await revokeOtherSessionsFn({ data: {} });
        toast.success(copy.othersRevoked);
        reload();
      });
    } catch (failure) {
      reportFailure(failure);
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsGroup label={copy.group}>
      {state.status === 'loading' ? (
        <div role="status" aria-label={messages.common.loading} className="grid gap-4 py-[18px]">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className="flex flex-col gap-3 py-[18px]">
          <InlineStatus variant="danger">{copy.loadFailed}</InlineStatus>
          <Button variant="outline" size="row" className="self-start" onClick={reload}>
            {messages.common.retry}
          </Button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          {state.data.map((session) => (
            <SettingsRow
              key={session.publicId}
              title={describeUserAgent(session.userAgent)}
              description={copy.detail(
                formatDateTime(new Date(session.createdAt), viewer.timezone),
                formatRelative(new Date(session.lastSeenAt), new Date()),
              )}
            >
              {session.current ? (
                <Badge dot="success">{copy.current}</Badge>
              ) : (
                <Button variant="outline" size="row" onClick={() => setTarget(session)}>
                  {copy.revoke}
                </Button>
              )}
            </SettingsRow>
          ))}
          <SettingsRow
            title={copy.othersTitle}
            description={state.data.length <= 1 ? copy.othersOnlyThis : undefined}
          >
            <Button variant="outline" size="row" disabled={state.data.length <= 1} loading={pending && target === null} onClick={() => void revokeOthers()}>
              {copy.revokeOthers}
            </Button>
          </SettingsRow>
        </>
      ) : null}

      <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : setTarget(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.revokeTitle}</DialogTitle>
            <DialogDescription>{copy.revokeBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{messages.common.cancel}</Button>
            </DialogClose>
            <Button variant="danger" loading={pending} onClick={() => (target === null ? undefined : void revoke(target))}>
              {copy.revoke}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsGroup>
  );
}
