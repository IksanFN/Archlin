import { emojiIconSchema } from '@archlin/platform/contracts';
import { z } from 'zod';
import { PROPERTY_KEY, fieldSchemaSchema } from './field-schema';

export const contextFieldsSchema = z.strictObject({
  summary: z.string().max(1000).nullable(),
  whenToUse: z.string().max(1000).nullable(),
  source: z.string().max(500).nullable(),
  aliases: z.array(z.string().trim().min(1).max(80)).max(20),
});
export type ContextFields = z.infer<typeof contextFieldsSchema>;

export const propertiesSchema = z.record(z.string().regex(PROPERTY_KEY), z.json());

export const createPageInputSchema = z.strictObject({
  spaceId: z.uuid(),
  parentId: z.uuid().nullable(),
  noteTypeId: z.uuid(),
  placement: z.enum(['first', 'last']),
  title: z.string().max(500).default(''),
});
// Callers that do not name the page leave the title out; the server function schema fills it in.
export type CreatePageInput = z.input<typeof createPageInputSchema>;

export const savePageInputSchema = z.strictObject({
  entityId: z.uuid(),
  baseVersion: z.int().min(1),
  title: z.string().max(500),
  content: z.json(),
  context: contextFieldsSchema,
  properties: propertiesSchema,
});
export type SavePageInput = z.infer<typeof savePageInputSchema>;

export const overwritePageInputSchema = savePageInputSchema.extend({ seenVersion: z.int().min(1) });
export type OverwritePageInput = z.infer<typeof overwritePageInputSchema>;

export const renamePageInputSchema = z.strictObject({
  entityId: z.uuid(),
  title: z.string().max(500),
});
export type RenamePageInput = z.infer<typeof renamePageInputSchema>;

export const changeNoteTypeInputSchema = z.strictObject({
  entityId: z.uuid(),
  baseVersion: z.int().min(1),
  noteTypeId: z.uuid(),
});
export type ChangeNoteTypeInput = z.infer<typeof changeNoteTypeInputSchema>;

export const pageIdInputSchema = z.strictObject({ entityId: z.uuid() });
export type PageIdInput = z.infer<typeof pageIdInputSchema>;

// recordView is explicit so a router refresh or a background reload does not count as opening the page.
export const pageScreenInputSchema = z.strictObject({ entityId: z.uuid(), recordView: z.boolean() });
export type PageScreenInput = z.infer<typeof pageScreenInputSchema>;

export const suggestPagesInputSchema = z.strictObject({
  q: z.string().max(200),
  spaceId: z.uuid(),
  excludeId: z.uuid().nullable(),
});
export type SuggestPagesInput = z.infer<typeof suggestPagesInputSchema>;

export const createLinkedPageInputSchema = z.strictObject({
  sourceEntityId: z.uuid(),
  title: z.string().trim().min(1).max(500),
});
export type CreateLinkedPageInput = z.infer<typeof createLinkedPageInputSchema>;

export const REVIEW_MODES = ['none', 'daily', 'spaced'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const noteTypeNameSchema = z.string().trim().min(1).max(60);

export const createNoteTypeInputSchema = z.strictObject({
  name: noteTypeNameSchema,
  icon: emojiIconSchema,
  fieldSchema: fieldSchemaSchema,
  template: z.json(),
  defaultReviewMode: z.enum(REVIEW_MODES),
});
export type CreateNoteTypeInput = z.infer<typeof createNoteTypeInputSchema>;

export const updateNoteTypeInputSchema = z.strictObject({
  id: z.uuid(),
  baseRevision: z.int().min(1),
  name: noteTypeNameSchema.optional(),
  icon: emojiIconSchema.optional(),
  fieldSchema: fieldSchemaSchema.optional(),
  template: z.json().optional(),
  defaultReviewMode: z.enum(REVIEW_MODES).optional(),
});
export type UpdateNoteTypeInput = z.infer<typeof updateNoteTypeInputSchema>;

export const deleteNoteTypeInputSchema = z.strictObject({
  id: z.uuid(),
  reassignTo: z.uuid().nullable(),
});
export type DeleteNoteTypeInput = z.infer<typeof deleteNoteTypeInputSchema>;

export const noteTypeIdInputSchema = z.strictObject({ id: z.uuid() });
export type NoteTypeIdInput = z.infer<typeof noteTypeIdInputSchema>;
