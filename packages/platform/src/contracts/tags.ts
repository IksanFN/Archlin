import { z } from 'zod';

export const tagNameSchema = z.string().trim().min(1).max(48);

export const setEntityTagsInputSchema = z.strictObject({
  entityId: z.uuid(),
  names: z.array(tagNameSchema).max(20),
});
export type SetEntityTagsInput = z.infer<typeof setEntityTagsInputSchema>;

export const suggestTagsInputSchema = z.strictObject({
  prefix: z.string().max(48),
});
export type SuggestTagsInput = z.infer<typeof suggestTagsInputSchema>;

export interface TagRef {
  id: string;
  name: string;
}
