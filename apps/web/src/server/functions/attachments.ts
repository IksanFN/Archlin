import {
  attachmentIdInputSchema,
  copyAttachmentsInputSchema,
  pageIdInputSchema,
  trashOrphansInputSchema,
} from '@archlin/modules-knowledge/shared';
import type { AttachmentView } from '@archlin/modules-knowledge/shared';
import { getContainer } from '~/server/container';
import { authedFn, strictInput } from '~/server/fn';

export const pageAttachmentsFn = authedFn
  .validator(strictInput(pageIdInputSchema))
  .handler(({ data, context }): Promise<AttachmentView[]> => {
    const { uow, knowledge } = getContainer();
    return uow.read(context.auth.scope, (tx) => knowledge.attachments.listForPage(tx, data.entityId));
  });

export const trashOrphanAttachmentsFn = authedFn
  .validator(strictInput(trashOrphansInputSchema))
  .handler(({ data, context }): Promise<{ trashed: number }> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.attachments.trashOrphans(tx, data));
  });

export const retryExtractionFn = authedFn
  .validator(strictInput(attachmentIdInputSchema))
  .handler(({ data, context }): Promise<AttachmentView> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.attachments.retryExtraction(tx, data));
  });

export const copyAttachmentsFn = authedFn
  .validator(strictInput(copyAttachmentsInputSchema))
  .handler(({ data, context }): Promise<Record<string, string>> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.attachments.copyToPage(tx, data));
  });
