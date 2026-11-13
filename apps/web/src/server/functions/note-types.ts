import {
  createNoteTypeInputSchema,
  deleteNoteTypeInputSchema,
  noteTypeIdInputSchema,
  updateNoteTypeInputSchema,
} from '@archlin/modules-knowledge/shared';
import type { NoteTypeDetail, NoteTypeSummary } from '@archlin/modules-knowledge/shared';
import { reorderInputSchema } from '@archlin/platform/contracts';
import { z } from 'zod';
import { getContainer } from '~/server/container';
import { authedFn, strictInput } from '~/server/fn';

export const noteTypesFn = authedFn
  .validator(strictInput(z.strictObject({})))
  .handler(({ context }): Promise<NoteTypeSummary[]> => {
    const { uow, knowledge } = getContainer();
    return uow.read(context.auth.scope, (tx) => knowledge.noteTypes.list(tx));
  });

export const noteTypeFn = authedFn
  .validator(strictInput(noteTypeIdInputSchema))
  .handler(({ data, context }): Promise<NoteTypeDetail> => {
    const { uow, knowledge } = getContainer();
    return uow.read(context.auth.scope, (tx) => knowledge.noteTypes.get(tx, data.id));
  });

export const createNoteTypeFn = authedFn
  .validator(strictInput(createNoteTypeInputSchema))
  .handler(({ data, context }): Promise<NoteTypeDetail> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.noteTypes.create(tx, data));
  });

export const updateNoteTypeFn = authedFn
  .validator(strictInput(updateNoteTypeInputSchema))
  .handler(({ data, context }): Promise<NoteTypeDetail> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.noteTypes.update(tx, data));
  });

export const reorderNoteTypeFn = authedFn
  .validator(strictInput(reorderInputSchema))
  .handler(({ data, context }): Promise<{ status: 'ok' }> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, async (tx) => {
      await knowledge.noteTypes.reorder(tx, data);
      return { status: 'ok' };
    });
  });

export const deleteNoteTypeFn = authedFn
  .validator(strictInput(deleteNoteTypeInputSchema))
  .handler(({ data, context }): Promise<{ reassigned: number }> => {
    const { uow, knowledge } = getContainer();
    return uow.write(context.auth.scope, (tx) => knowledge.noteTypes.remove(tx, data));
  });
