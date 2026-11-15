import type { Clock, EventPublisher, Ids } from '@archlin/kernel';
import type { LinkService, TagService, TreeService } from '@archlin/platform/server';
import { createNoteTypeService, type NoteTypeService } from './note-type-service';
import { createPageService, type PageService } from './page-service';
import { createVersionService, type VersionService } from './version-service';

export interface KnowledgeApi {
  pages: PageService;
  noteTypes: NoteTypeService;
  versions: VersionService;
}

export function createKnowledgeApi(deps: {
  tree: TreeService;
  tags: TagService;
  links: LinkService;
  publisher: EventPublisher;
  clock: Clock;
  ids: Ids;
}): KnowledgeApi {
  return {
    pages: createPageService(deps),
    noteTypes: createNoteTypeService(deps),
    versions: createVersionService(deps),
  };
}
