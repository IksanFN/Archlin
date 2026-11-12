import { defineEvent } from '@archlin/kernel';
import { z } from 'zod';

const fieldName = z.string().regex(/^[a-z][a-zA-Z0-9]{0,47}$/);

export const entityCreated = defineEvent({
  type: 'entity.created',
  schemaVersion: 1,
  payload: z.strictObject({
    kind: z.string(),
    spaceId: z.uuid(),
    parentId: z.uuid().nullable(),
  }),
});

export const entityUpdated = defineEvent({
  type: 'entity.updated',
  schemaVersion: 1,
  payload: z.strictObject({
    kind: z.string(),
    fields: z.array(fieldName).min(1).max(16),
  }),
});

export const entityMoved = defineEvent({
  type: 'entity.moved',
  schemaVersion: 1,
  payload: z.strictObject({
    kind: z.string(),
    fromSpaceId: z.uuid(),
    toSpaceId: z.uuid(),
    fromParentId: z.uuid().nullable(),
    toParentId: z.uuid().nullable(),
  }),
});

export const entityDeleted = defineEvent({
  type: 'entity.deleted',
  schemaVersion: 1,
  payload: z.strictObject({
    kind: z.string(),
    rootId: z.uuid(),
  }),
});

export const entityRestored = defineEvent({
  type: 'entity.restored',
  schemaVersion: 1,
  payload: z.strictObject({
    kind: z.string(),
    rootId: z.uuid(),
  }),
});
