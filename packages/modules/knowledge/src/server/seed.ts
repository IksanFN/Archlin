import type { Ids } from '@archlin/kernel';
import type { Kysely, Transaction } from 'kysely';
import type { KnowledgeDatabase } from './schema';
import { SYSTEM_NOTE_TYPES } from './system-note-types';

export async function seedSystemNoteTypes(
  db: Kysely<KnowledgeDatabase> | Transaction<KnowledgeDatabase>,
  ownerId: string,
  ids: Ids,
  now: Date,
): Promise<number> {
  const result = await db
    .insertInto('kb_note_types')
    .values(
      SYSTEM_NOTE_TYPES.map((type) => ({
        id: ids.uuidv7(),
        owner_id: ownerId,
        key: type.key,
        name: type.name,
        icon: type.icon,
        // pg treats JS arrays as SQL arrays; jsonb columns need a JSON string.
        template: JSON.stringify(type.template),
        field_schema: JSON.stringify(type.fieldSchema),
        schema_version: 1,
        default_review_mode: type.defaultReviewMode,
        is_system: type.isSystem,
        position: type.position,
        created_at: now,
        updated_at: now,
      })),
    )
    .onConflict((oc) => oc.columns(['owner_id', 'key']).doNothing())
    .executeTakeFirst();
  return Number(result?.numInsertedOrUpdatedRows ?? 0);
}
