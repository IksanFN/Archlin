import { EmptyState } from '@archlin/ui/shell/empty-state';
import { LockSimpleIcon, SunHorizonIcon } from '@phosphor-icons/react/ssr';
import { createFileRoute } from '@tanstack/react-router';
import type { CSSProperties } from 'react';
import { messages } from '~/i18n/id';
import { formatToday, greetingFor } from '~/lib/greeting';

export const Route = createFileRoute('/_app/')({
  // The instant is read once on the server and shipped, so the heading cannot differ between server and browser render.
  loader: () => ({ nowIso: new Date().toISOString() }),
  head: () => ({ meta: [{ title: `${messages.nav.today} · ${messages.appName}` }] }),
  component: TodayPage,
});

const rise = (index: number): CSSProperties => ({ '--rise-index': index }) as CSSProperties;

function TodayPage() {
  const { viewer } = Route.useRouteContext();
  const { nowIso } = Route.useLoaderData();
  const now = new Date(nowIso);
  return (
    <div className="flex flex-1 flex-col px-4 pt-6 pb-10 nav:px-12 nav:pt-[88px]">
      <div className="mx-auto w-full max-w-[640px]">
        <div className="rise" style={rise(0)}>
          <h1 className="text-title text-fg">{formatToday(now, viewer.timezone)}</h1>
          <p className="mt-1.5 text-small text-fg-muted">
            {messages.today.greeting(greetingFor(now, viewer.timezone), viewer.displayName)}
          </p>
        </div>
        <EmptyState
          className="rise mt-16"
          style={rise(1)}
          icon={SunHorizonIcon}
          title={messages.today.emptyTitle}
          body={messages.today.emptyBody}
        />
      </div>
      <p className="rise mx-auto mt-auto flex items-center gap-2 pt-16 text-micro text-fg-muted" style={rise(2)}>
        <LockSimpleIcon aria-hidden="true" size={12} />
        {messages.today.privacyFooter}
      </p>
    </div>
  );
}
