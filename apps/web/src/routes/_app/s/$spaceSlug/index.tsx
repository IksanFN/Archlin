import { createFileRoute, notFound } from '@tanstack/react-router';
import { SpaceHome } from '~/components/space-home';
import { messages } from '~/i18n/id';
import { AppError } from '~/server/errors';
import { spaceHomeFn } from '~/server/functions/spaces';

export const Route = createFileRoute('/_app/s/$spaceSlug/')({
  loader: async ({ params }) => {
    try {
      const home = await spaceHomeFn({ data: { slug: params.spaceSlug } });
      return { ...home, mobileTitle: home.space.name, nowIso: new Date().toISOString() };
    } catch (error) {
      // spaceHomeFn maps a missing slug to 404; notFound() is what renders the M0 empty-search screen.
      if (error instanceof AppError && error.status === 404) throw notFound();
      throw error;
    }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData === undefined ? messages.appName : `${loaderData.space.name} · ${messages.appName}` }],
  }),
  component: SpaceHomePage,
});

function SpaceHomePage() {
  const { space, rootPages, recent, nowIso } = Route.useLoaderData();
  return <SpaceHome space={space} rootPages={rootPages} recent={recent} now={new Date(nowIso)} />;
}
