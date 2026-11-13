import {
  entityIdInputSchema,
  moveEntityInputSchema,
  setIconInputSchema,
  setStarredInputSchema,
  treeChildrenInputSchema,
} from '@archlin/platform/contracts';
import type { EntityRef, TreeNode } from '@archlin/platform/contracts';
import { z } from 'zod';
import { getContainer } from '~/server/container';
import { authedFn, strictInput } from '~/server/fn';

export const treeChildrenFn = authedFn
  .validator(strictInput(treeChildrenInputSchema))
  .handler(({ data, context }): Promise<TreeNode[]> => {
    const { uow, tree } = getContainer();
    return uow.read(context.auth.scope, (tx) => tree.children(tx, data));
  });

export const moveEntityFn = authedFn
  .validator(strictInput(moveEntityInputSchema))
  .handler(({ data, context }): Promise<{ spaceSlug: string; parentId: string | null }> => {
    const { uow, tree, spaces } = getContainer();
    return uow.write(context.auth.scope, async (tx) => {
      const moved = await tree.move(tx, data);
      // EntityRecord carries spaceId; the client navigates by slug.
      const space = await spaces.get(tx, moved.spaceId);
      return { spaceSlug: space.slug, parentId: moved.parentId };
    });
  });

export const trashEntityFn = authedFn
  .validator(strictInput(entityIdInputSchema))
  .handler(({ data, context }): Promise<{ rootId: string; count: number }> => {
    const { uow, tree } = getContainer();
    return uow.write(context.auth.scope, (tx) => tree.trash(tx, data.entityId));
  });

export const setStarredFn = authedFn
  .validator(strictInput(setStarredInputSchema))
  .handler(({ data, context }): Promise<{ status: 'ok' }> => {
    const { uow, tree } = getContainer();
    return uow.write(context.auth.scope, async (tx) => {
      await tree.setStarred(tx, data.entityId, data.starred);
      return { status: 'ok' };
    });
  });

export const setIconFn = authedFn
  .validator(strictInput(setIconInputSchema))
  .handler(({ data, context }): Promise<{ status: 'ok' }> => {
    const { uow, tree } = getContainer();
    return uow.write(context.auth.scope, async (tx) => {
      await tree.setIcon(tx, data.entityId, data.icon);
      return { status: 'ok' };
    });
  });

export const favoritesFn = authedFn
  .validator(strictInput(z.strictObject({})))
  .handler(({ context }): Promise<EntityRef[]> => {
    const { uow, tree } = getContainer();
    return uow.read(context.auth.scope, (tx) => tree.starred(tx));
  });
