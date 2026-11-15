import {
  changeNoteTypeInputSchema,
  createPageInputSchema,
  overwritePageInputSchema,
  pageScreenInputSchema,
  renamePageInputSchema,
  savePageInputSchema,
} from '@archlin/modules-knowledge/shared';
import type { PageScreen, PageView, SaveResult } from '@archlin/modules-knowledge/shared';
import { getContainer } from '~/server/container';
import { authedFn, strictInput } from '~/server/fn';

export const createPageFn = authedFn
  .validator(strictInput(createPageInputSchema))
  .handler(({ data, context }): Promise<{ entityId: string; spaceSlug: string }> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.pages.createPage(tx, data));
  });

export const pageFn = authedFn
  .validator(strictInput(pageScreenInputSchema))
  .handler(({ data, context }): Promise<PageScreen> => {
    const { uow, knowledge } = getContainer();
    // recordView writes, so the whole screen is read in one write transaction even when the view is not counted.
    return uow.write(context.auth.scope, (tx) => knowledge.pages.screen(tx, data));
  });

export const savePageFn = authedFn
  .validator(strictInput(savePageInputSchema))
  .handler(({ data, context }): Promise<SaveResult> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.pages.savePage(tx, data));
  });

export const saveConflictCopyFn = authedFn
  .validator(strictInput(savePageInputSchema))
  .handler(({ data, context }): Promise<{ versionId: string }> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.pages.saveConflictCopy(tx, data));
  });

export const overwritePageFn = authedFn
  .validator(strictInput(overwritePageInputSchema))
  .handler(({ data, context }): Promise<SaveResult> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.pages.overwritePage(tx, data));
  });

export const renamePageFn = authedFn
  .validator(strictInput(renamePageInputSchema))
  .handler(({ data, context }): Promise<{ version: number }> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.pages.renamePage(tx, data));
  });

export const changeNoteTypeFn = authedFn
  .validator(strictInput(changeNoteTypeInputSchema))
  .handler(({ data, context }): Promise<PageView> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.pages.changeNoteType(tx, data));
  });
