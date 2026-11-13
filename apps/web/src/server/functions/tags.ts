import { setEntityTagsInputSchema, suggestTagsInputSchema } from '@archlin/platform/contracts';
import type { TagRef } from '@archlin/platform/contracts';
import { getContainer } from '~/server/container';
import { authedFn, strictInput } from '~/server/fn';

export const suggestTagsFn = authedFn
  .validator(strictInput(suggestTagsInputSchema))
  .handler(({ data, context }): Promise<TagRef[]> => {
    const { uow, tags } = getContainer();
    return uow.read(context.auth.scope, (tx) => tags.suggest(tx, data.prefix));
  });

export const setEntityTagsFn = authedFn
  .validator(strictInput(setEntityTagsInputSchema))
  .handler(({ data, context }): Promise<TagRef[]> => {
    const { uow, tags } = getContainer();
    return uow.write(context.auth.scope, (tx) => tags.setForEntity(tx, data.entityId, data.names));
  });
