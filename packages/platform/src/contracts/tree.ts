import { z } from 'zod';
import { emojiIconSchema } from './icons';

export const MAX_TREE_DEPTH = 32;
export const TRASH_RETENTION_DAYS = 30;

export type Placement = 'first' | 'last' | { readonly afterId: string };

export const moveEntityInputSchema = z
  .strictObject({
    entityId: z.uuid(),
    targetSpaceId: z.uuid(),
    newParentId: z.uuid().nullable(),
    beforeId: z.uuid().nullable(),
    afterId: z.uuid().nullable(),
  })
  .refine((value) => value.beforeId === null || value.afterId === null);
export type MoveEntityInput = z.infer<typeof moveEntityInputSchema>;

export const treeChildrenInputSchema = z.strictObject({
  spaceId: z.uuid(),
  parentId: z.uuid().nullable(),
});
export type TreeChildrenInput = z.infer<typeof treeChildrenInputSchema>;

export const entityIdInputSchema = z.strictObject({ entityId: z.uuid() });
export type EntityIdInput = z.infer<typeof entityIdInputSchema>;

export const trashRootInputSchema = z.strictObject({ rootId: z.uuid() });
export type TrashRootInput = z.infer<typeof trashRootInputSchema>;

export const setStarredInputSchema = z.strictObject({
  entityId: z.uuid(),
  starred: z.boolean(),
});
export type SetStarredInput = z.infer<typeof setStarredInputSchema>;

export const setIconInputSchema = z.strictObject({
  entityId: z.uuid(),
  icon: emojiIconSchema,
});
export type SetIconInput = z.infer<typeof setIconInputSchema>;

export interface TreeNode {
  id: string;
  kind: string;
  title: string;
  icon: string | null;
  isStarred: boolean;
  hasChildren: boolean;
}

export interface EntityRef {
  id: string;
  kind: string;
  title: string;
  icon: string | null;
  spaceId: string;
  spaceSlug: string;
}

export interface Breadcrumb {
  id: string;
  title: string;
  icon: string | null;
}

export interface TrashRoot {
  rootId: string;
  kind: string;
  title: string;
  icon: string | null;
  spaceName: string;
  parentTitle: string | null;
  descendantCount: number;
  attachedCount: number;
  deletedAt: string;
  purgeAt: string;
}

export interface RestoreOutcome {
  entityId: string;
  spaceSlug: string;
  parentId: string | null;
  restoredToRoot: boolean;
  spaceArchived: boolean;
  count: number;
}

export interface RecentEntity extends EntityRef {
  updatedAt: string;
}
