import {
  listVersionsInputSchema,
  restoreVersionInputSchema,
  snapshotPageInputSchema,
  versionInputSchema,
} from '@archlin/modules-knowledge/shared';
import type { RestoreVersionResult, SnapshotResult, VersionDetail, VersionPage } from '@archlin/modules-knowledge/shared';
import { getContainer } from '~/server/container';
import { authedFn, strictInput } from '~/server/fn';

export const listVersionsFn = authedFn
  .validator(strictInput(listVersionsInputSchema))
  .handler(({ data, context }): Promise<VersionPage> => {
    const { uow, knowledge } = getContainer();
    return uow.read(context.auth.scope, (tx) => knowledge.versions.list(tx, data));
  });

export const versionFn = authedFn
  .validator(strictInput(versionInputSchema))
  .handler(({ data, context }): Promise<VersionDetail> => {
    const { uow, knowledge } = getContainer();
    return uow.read(context.auth.scope, (tx) => knowledge.versions.get(tx, data));
  });

export const snapshotPageFn = authedFn
  .validator(strictInput(snapshotPageInputSchema))
  .handler(({ data, context }): Promise<SnapshotResult> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.versions.snapshot(tx, data));
  });

export const restoreVersionFn = authedFn
  .validator(strictInput(restoreVersionInputSchema))
  .handler(({ data, context }): Promise<RestoreVersionResult> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.versions.restore(tx, data));
  });
