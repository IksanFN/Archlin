import type { ExtractionStatus } from '@archlin/modules-knowledge/shared';

export interface AttachmentLabels {
  title: string;
  upload: string;
  open: string;
  download: string;
  status: Readonly<Record<ExtractionStatus, string>>;
  retry: string;
  unusedTitle: string;
  unusedBody: string;
  moveUnused: string;
  movedUnused: (count: number) => string;
  emptyTitle: string;
  emptyBody: string;
  uploading: (name: string) => string;
  uploaded: (name: string) => string;
  uploadFailed: (name: string) => string;
  cancel: string;
  discard: string;
  dropHere: string;
  missing: string;
  inTrash: string;
  tooLarge: (name: string) => string;
  fileEmpty: string;
  copyFailed: string;
  loadFailed: string;
  closePanel: string;
  uploadProgress: (name: string) => string;
}
