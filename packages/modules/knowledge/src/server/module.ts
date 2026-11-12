import { sqlFor } from '@archlin/db/scoped';
import { defineEvent, defineHandler, defineModule } from '@archlin/kernel';
import type { ModuleDraft, ModuleServerDeps } from '@archlin/kernel';
import { accountCreated } from '@archlin/platform/server';
import { z } from 'zod';
import type { KnowledgeDatabase } from './schema';
import { seedSystemNoteTypes } from './seed';

export const KB_MODULE_ID = 'kb';
export const PAGE_KIND = 'kb.page';

export const noteTypeUpdated = defineEvent({
  type: 'kb.noteType.updated',
  schemaVersion: 1,
  payload: z.strictObject({ fieldsChanged: z.boolean() }),
});

export function createKnowledgeModule(deps: ModuleServerDeps): ModuleDraft {
  const seedOnAccountCreated = defineHandler({
    id: 'seedSystemNoteTypes',
    event: accountCreated,
    mode: 'sync',
    handle: async (event, tx) => {
      await seedSystemNoteTypes(sqlFor<KnowledgeDatabase>(tx), event.ownerId, deps.ids, new Date(event.occurredAt));
    },
  });

  return defineModule({
    id: KB_MODULE_ID,
    entityKinds: { page: { label: 'Halaman', icon: 'file-text', treeable: true } },
    events: [noteTypeUpdated],
    eventHandlers: [seedOnAccountCreated],
  });
}
