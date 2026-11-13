import { KnowledgeClientError, type KnowledgeClient } from '@archlin/modules-knowledge/web';
import { AppError } from '~/server/errors';
import {
  createNoteTypeFn,
  deleteNoteTypeFn,
  noteTypeFn,
  noteTypesFn,
  reorderNoteTypeFn,
  updateNoteTypeFn,
} from '~/server/functions/note-types';
import { changeNoteTypeFn, overwritePageFn, pageFn, saveConflictCopyFn, savePageFn } from '~/server/functions/pages';
import { setEntityTagsFn, suggestTagsFn } from '~/server/functions/tags';

async function invoke<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError) {
      throw new KnowledgeClientError({
        code: error.code,
        message: error.message,
        status: error.status,
        details: error.details,
        requestId: error.requestId,
      });
    }
    throw error;
  }
}

export const knowledgeClient: KnowledgeClient = {
  savePage: (input) => invoke(() => savePageFn({ data: input })),
  saveConflictCopy: (input) => invoke(() => saveConflictCopyFn({ data: input })),
  overwritePage: (input) => invoke(() => overwritePageFn({ data: input })),
  getPage: (entityId) => invoke(() => pageFn({ data: { entityId } })),
  changeNoteType: (input) => invoke(() => changeNoteTypeFn({ data: input })),
  suggestTags: (prefix) => invoke(() => suggestTagsFn({ data: { prefix } })),
  setTags: (entityId, names) => invoke(() => setEntityTagsFn({ data: { entityId, names: [...names] } })),
  listNoteTypes: () => invoke(() => noteTypesFn({ data: {} })),
  getNoteType: (id) => invoke(() => noteTypeFn({ data: { id } })),
  createNoteType: (input) => invoke(() => createNoteTypeFn({ data: input })),
  updateNoteType: (input) => invoke(() => updateNoteTypeFn({ data: input })),
  reorderNoteType: async (input) => {
    await invoke(() => reorderNoteTypeFn({ data: input }));
  },
  deleteNoteType: (input) => invoke(() => deleteNoteTypeFn({ data: input })),
};
