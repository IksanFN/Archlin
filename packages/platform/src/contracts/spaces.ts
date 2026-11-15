import { z } from 'zod';
import { emojiIconSchema } from './icons';

export const spaceNameSchema = z.string().trim().min(1).max(80);

export const createSpaceInputSchema = z.strictObject({
  name: spaceNameSchema,
  icon: emojiIconSchema,
});

export const updateSpaceInputSchema = z.strictObject({
  id: z.uuid(),
  name: spaceNameSchema.optional(),
  icon: emojiIconSchema.optional(),
});

export const reorderInputSchema = z
  .strictObject({
    id: z.uuid(),
    beforeId: z.uuid().nullable(),
    afterId: z.uuid().nullable(),
  })
  .refine((value) => value.beforeId === null || value.afterId === null);

export const spaceIdInputSchema = z.strictObject({ id: z.uuid() });
export const listSpacesInputSchema = z.strictObject({ includeArchived: z.boolean() });
export const spaceSlugInputSchema = z.strictObject({
  slug: z.string().max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
});

export type CreateSpaceInput = z.infer<typeof createSpaceInputSchema>;
export type UpdateSpaceInput = z.infer<typeof updateSpaceInputSchema>;
export type ReorderInput = z.infer<typeof reorderInputSchema>;
export type SpaceIdInput = z.infer<typeof spaceIdInputSchema>;
export type ListSpacesInput = z.infer<typeof listSpacesInputSchema>;
export type SpaceSlugInput = z.infer<typeof spaceSlugInputSchema>;

export interface SpaceSummary {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  archivedAt: string | null;
  pageCount: number;
}
