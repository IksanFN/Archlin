import { z } from 'zod';
import { PROPERTY_KEY } from './field-schema';

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
});
export type CreatePageInput = z.infer<typeof createPageInputSchema>;

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
