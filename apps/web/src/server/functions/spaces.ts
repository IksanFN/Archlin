import {
  createSpaceInputSchema,
  listSpacesInputSchema,
  reorderInputSchema,
  spaceIdInputSchema,
  spaceSlugInputSchema,
  updateSpaceInputSchema,
} from '@archlin/platform/contracts';
import type { RecentEntity, SpaceSummary, TreeNode } from '@archlin/platform/contracts';
import { messages } from '~/i18n/id';
import { getContainer } from '~/server/container';
import { authedFn, strictInput } from '~/server/fn';

export interface SpaceHome {
  space: SpaceSummary;
  rootPages: Array<TreeNode & { summary: string | null; descendantCount: number }>;
  recent: Array<RecentEntity & { path: string }>;
}

export const listSpacesFn = authedFn
  .validator(strictInput(listSpacesInputSchema))
  .handler(({ data, context }): Promise<SpaceSummary[]> => {
    const { uow, spaces } = getContainer();
    return uow.read(context.auth.scope, (tx) => spaces.list(tx, data));
  });

export const createSpaceFn = authedFn
  .validator(strictInput(createSpaceInputSchema))
  .handler(({ data, context }): Promise<SpaceSummary> => {
    const { uow, spaces } = getContainer();
    return uow.write(context.auth.scope, (tx) => spaces.create(tx, data));
  });

export const updateSpaceFn = authedFn
  .validator(strictInput(updateSpaceInputSchema))
  .handler(({ data, context }): Promise<SpaceSummary> => {
    const { uow, spaces } = getContainer();
    return uow.write(context.auth.scope, (tx) => spaces.update(tx, data));
  });

export const reorderSpaceFn = authedFn
  .validator(strictInput(reorderInputSchema))
  .handler(({ data, context }): Promise<{ status: 'ok' }> => {
    const { uow, spaces } = getContainer();
    return uow.write(context.auth.scope, async (tx) => {
      await spaces.reorder(tx, data);
      return { status: 'ok' };
    });
  });

export const archiveSpaceFn = authedFn
  .validator(strictInput(spaceIdInputSchema))
  .handler(({ data, context }): Promise<SpaceSummary> => {
    const { uow, spaces } = getContainer();
    return uow.write(context.auth.scope, (tx) => spaces.archive(tx, data.id));
  });

export const unarchiveSpaceFn = authedFn
  .validator(strictInput(spaceIdInputSchema))
  .handler(({ data, context }): Promise<SpaceSummary> => {
    const { uow, spaces } = getContainer();
    return uow.write(context.auth.scope, (tx) => spaces.unarchive(tx, data.id));
  });

export const spaceHomeFn = authedFn
  .validator(strictInput(spaceSlugInputSchema))
  .handler(({ data, context }): Promise<SpaceHome> => {
    const { uow, spaces, tree, knowledge } = getContainer();
    return uow.read(context.auth.scope, async (tx) => {
      const space = await spaces.getBySlug(tx, data.slug);
      const roots = await tree.children(tx, { spaceId: space.id, parentId: null });
      const rootIds = roots.map((node) => node.id);
      const summaries = await knowledge.pages.summaries(tx, rootIds);
      const counts = await tree.subtreeCounts(tx, rootIds);
      const recents = await tree.recentInSpace(tx, space.id, 10);
      const recent: SpaceHome['recent'] = [];
      for (const entity of recents) {
        const crumbs = await tree.ancestors(tx, entity.id);
        recent.push({
          ...entity,
          path: crumbs.map((crumb) => (crumb.title === '' ? messages.page.untitled : crumb.title)).join(' / '),
        });
      }
      return {
        space,
        rootPages: roots.map((node) => ({
          ...node,
          summary: summaries.get(node.id) ?? null,
          descendantCount: counts.get(node.id) ?? 0,
        })),
        recent,
      };
    });
  });
