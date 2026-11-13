import { trashRootInputSchema } from '@archlin/platform/contracts';
import type { RestoreOutcome, TrashRoot } from '@archlin/platform/contracts';
import { z } from 'zod';
import { getContainer } from '~/server/container';
import { authedFn, strictInput } from '~/server/fn';

export const trashListFn = authedFn
  .validator(strictInput(z.strictObject({})))
  .handler(({ context }): Promise<TrashRoot[]> => {
    const { uow, tree } = getContainer();
    return uow.read(context.auth.scope, (tx) => tree.trashRoots(tx));
  });

export const restoreFn = authedFn
  .validator(strictInput(trashRootInputSchema))
  .handler(({ data, context }): Promise<RestoreOutcome> => {
    const { uow, tree } = getContainer();
    return uow.write(context.auth.scope, (tx) => tree.restore(tx, data.rootId));
  });

export const purgeFn = authedFn
  .validator(strictInput(trashRootInputSchema))
  .handler(({ data, context }): Promise<{ count: number }> => {
    const { uow, tree } = getContainer();
    return uow.write(context.auth.scope, (tx) => tree.purge(tx, data.rootId));
  });

export const emptyTrashFn = authedFn
  .validator(strictInput(z.strictObject({})))
  .handler(({ context }): Promise<{ roots: number; count: number }> => {
    const { uow, tree } = getContainer();
    return uow.write(context.auth.scope, (tx) => tree.emptyTrash(tx));
  });
