import type { AttachmentStore } from './attachment-store';
import type { UploadQueue } from './upload-queue';

export interface PageEditorAttachments {
  pageId: string;
  store: AttachmentStore;
  queue: UploadQueue;
}
