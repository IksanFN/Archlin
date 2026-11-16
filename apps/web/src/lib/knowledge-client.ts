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
import {
  copyAttachmentsFn,
  pageAttachmentsFn,
  retryExtractionFn,
  trashOrphanAttachmentsFn,
} from '~/server/functions/attachments';
import {
  changeNoteTypeFn,
  createLinkedPageFn,
  duplicatePageFn,
  overwritePageFn,
  pageFn,
  saveConflictCopyFn,
  savePageFn,
  suggestPagesFn,
} from '~/server/functions/pages';
import { setEntityTagsFn, suggestTagsFn } from '~/server/functions/tags';
import { listVersionsFn, restoreVersionFn, snapshotPageFn, versionFn } from '~/server/functions/versions';
import { uploadFile } from './upload-client';

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
  getPage: (entityId) => invoke(() => pageFn({ data: { entityId, recordView: false } })),
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
  suggestPages: (input) => invoke(() => suggestPagesFn({ data: input })),
  createLinkedPage: (input) => invoke(() => createLinkedPageFn({ data: input })),
  duplicatePage: (input) => invoke(() => duplicatePageFn({ data: input })),
  listVersions: (input) => invoke(() => listVersionsFn({ data: input })),
  getVersion: (input) => invoke(() => versionFn({ data: input })),
  snapshotPage: (input) => invoke(() => snapshotPageFn({ data: input })),
  restoreVersion: (input) => invoke(() => restoreVersionFn({ data: input })),
  listAttachments: (pageId) => invoke(() => pageAttachmentsFn({ data: { entityId: pageId } })),
  trashOrphanAttachments: (input) => invoke(() => trashOrphanAttachmentsFn({ data: input })),
  retryExtraction: (attachmentId) => invoke(() => retryExtractionFn({ data: { attachmentId } })),
  copyAttachments: (input) => invoke(() => copyAttachmentsFn({ data: input })),
  uploadFile,
};
