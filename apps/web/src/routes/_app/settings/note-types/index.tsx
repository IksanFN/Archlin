import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { NoteTypeList } from '@archlin/modules-knowledge/web';
import { messages } from '~/i18n/id';
import { noteTypesFn } from '~/server/functions/note-types';

export const Route = createFileRoute('/_app/settings/note-types/')({
  head: () => ({ meta: [{ title: `${messages.noteTypes.title} · ${messages.appName}` }] }),
  loader: async () => ({ types: await noteTypesFn({ data: {} }), mobileTitle: messages.noteTypes.title }),
  component: NoteTypesPage,
});

function NoteTypesPage() {
  const { types } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  return (
    <div className="px-4 py-6 md:p-12">
      <div className="max-w-[760px]">
        <NoteTypeList
          types={types}
          labels={messages.noteTypes}
          onChanged={() => void router.invalidate()}
          onCreated={(id) => void navigate({ to: '/settings/note-types/$noteTypeId', params: { noteTypeId: id } })}
          renderLink={(type, className, children) => (
            <Link to="/settings/note-types/$noteTypeId" params={{ noteTypeId: type.id }} className={className}>
              {children}
            </Link>
          )}
        />
      </div>
    </div>
  );
}
