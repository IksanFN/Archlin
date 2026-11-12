import { createFileRoute, redirect } from '@tanstack/react-router';

// /settings has no page of its own yet; the one section that exists is the landing screen.
export const Route = createFileRoute('/_app/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/security' });
  },
});
