import type { Clock, EventPublisher, Ids } from '@archlin/kernel';
import type { BlobService, LinkService, TagService, TreeService } from '@archlin/platform/server';
import { createAttachmentService, type AttachmentService } from './attachment-service';
import { createNoteTypeService, type NoteTypeService } from './note-type-service';
import { createPageService, type PageService } from './page-service';
import { createVersionService, type VersionService } from './version-service';

export interface KnowledgeApi {
  pages: PageService;
  noteTypes: NoteTypeService;
  versions: VersionService;
  attachments: AttachmentService;
}

export function createKnowledgeApi(deps: {
  tree: TreeService;
  tags: TagService;
  links: LinkService;
  blobs: BlobService;
  publisher: EventPublisher;
  clock: Clock;
  ids: Ids;
}): KnowledgeApi {
  const attachments = createAttachmentService(deps);
  return {
    pages: createPageService({ ...deps, attachments }),
    noteTypes: createNoteTypeService(deps),
    versions: createVersionService(deps),
    attachments,
  };
}
