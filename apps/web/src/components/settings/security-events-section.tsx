import type { Viewer } from '@archlin/platform/contracts';
import { Button } from '@archlin/ui/components/button';
import { InlineStatus } from '@archlin/ui/components/inline-status';
import { Skeleton } from '@archlin/ui/components/skeleton';
import { messages } from '~/i18n/id';
import { formatDateTime } from '~/lib/format-time';
import { securityEventLabel } from '~/lib/security-event-labels';
import { useAsyncData } from '~/lib/use-async-data';
import { describeUserAgent } from '~/lib/user-agent';
import { securityEventsFn } from '~/server/functions/account';
import { SettingsGroup, SettingsRow } from './settings-row';

const copy = messages.settings.events;

const loadEvents = () => securityEventsFn({ data: { limit: 50 } });

export function SecurityEventsSection({ viewer }: { viewer: Viewer }) {
  const { state, reload } = useAsyncData(loadEvents);
  return (
    <SettingsGroup label={copy.group}>
      {state.status === 'loading' ? (
        <div role="status" aria-label={messages.common.loading} className="grid gap-4 py-[18px]">
          <Skeleton className="h-10" />
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
      {state.status === 'ready' && state.data.length === 0 ? (
        <p className="py-[18px] text-small text-fg-muted">{copy.empty}</p>
      ) : null}
      {state.status === 'ready'
        ? state.data.map((event, index) => (
            <SettingsRow
              key={`${event.createdAt}-${event.event}-${index}`}
              title={securityEventLabel(event.event)}
              description={
                <>
                  {formatDateTime(new Date(event.createdAt), viewer.timezone)} · {describeUserAgent(event.userAgent)}
                  {event.ip === null ? null : (
                    <>
                      {' · '}
                      <span className="font-mono">{event.ip}</span>
                    </>
                  )}
                </>
              }
            />
          ))
        : null}
    </SettingsGroup>
  );
}
