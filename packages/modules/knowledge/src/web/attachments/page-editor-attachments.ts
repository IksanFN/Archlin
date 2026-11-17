import type { AttachmentStore } from './attachment-store';
import type { UploadQueue } from './upload-queue';

export interface PageEditorAttachments {
  pageId: string;
  store: AttachmentStore;
  queue: UploadQueue;
  // Copies attachments of another page into this one and answers old id to new id.
  copy(ids: string[]): Promise<Record<string, string>>;
  // Reloads the list so cards show a copied file as soon as its id is swapped in.
  refresh(): Promise<void>;
}
