import { AppShell } from '@archlin/ui/shell/app-shell';
import { createFileRoute, Outlet, redirect, useLocation } from '@tanstack/react-router';
import { AppSidebar } from '~/components/app-sidebar';
import { messages } from '~/i18n/id';
import { AppError } from '~/server/errors';
import { authStateFn } from '~/server/functions/auth';
import { viewerFn } from '~/server/functions/account';

// Every signed-in screen sits under this guard; the server still checks the session on each call (spec 13.4 K2).
export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    try {
      return { viewer: await viewerFn({ data: {} }) };
    } catch (error) {
      if (error instanceof AppError && error.status === 401) {
        const { accountExists } = await authStateFn({ data: {} });
        throw redirect({ to: accountExists ? '/login' : '/setup' });
      }
      throw error;
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const { viewer } = Route.useRouteContext();
  const { pathname } = useLocation();
  const title = pathname.startsWith('/settings') ? messages.nav.settings : messages.nav.today;
  return (
    <AppShell
      title={title}
      sidebar={<AppSidebar displayName={viewer.displayName} />}
      labels={{
        skipToContent: messages.common.skipToContent,
        navigation: messages.nav.label,
        openNavigation: messages.nav.openNavigation,
      }}
    >
      <Outlet />
    </AppShell>
  );
}
