import { createFileRoute, Outlet } from '@tanstack/react-router';

// Nested page routes share this segment; the home and the page each own their chrome.
export const Route = createFileRoute('/_app/s/$spaceSlug')({
  component: () => <Outlet />,
});
