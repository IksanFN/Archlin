import type { Clock, EventPublisher, Ids } from '@archlin/kernel';
import type { TagService, TreeService } from '@archlin/platform/server';
import { createPageService, type PageService } from './page-service';

export interface KnowledgeApi {
  pages: PageService;
}

export function createKnowledgeApi(deps: {
  tree: TreeService;
  tags: TagService;
  publisher: EventPublisher;
  clock: Clock;
  ids: Ids;
}): KnowledgeApi {
  return {
    pages: createPageService(deps),
  };
}
