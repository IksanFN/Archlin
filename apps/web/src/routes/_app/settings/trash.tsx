import { createFileRoute } from '@tanstack/react-router';
import { TrashList } from '~/components/settings/trash-list';
import { messages } from '~/i18n/id';

export const Route = createFileRoute('/_app/settings/trash')({
  head: () => ({ meta: [{ title: `${messages.settings.trash.title} · ${messages.appName}` }] }),
  loader: () => ({ mobileTitle: messages.settings.trash.title }),
  component: TrashPage,
});

function TrashPage() {
  return <TrashList />;
}
