import type { PageSuggestion } from '@archlin/modules-knowledge/shared';
import type { KnowledgeClient } from '../client';
import type { LinkTargetStore } from './link-targets';

export interface PageEditorLinks {
  store: LinkTargetStore;
  entityId: string;
  spaceId: string;
  spaceSlug: string;
  client: Pick<KnowledgeClient, 'suggestPages'>;
  navigate(href: string): void;
  createLinkedPage(title: string): Promise<{ entityId: string; spaceSlug: string }>;
}

export interface LinkLabels {
  searching: string;
  empty: string;
  loadFailed: string;
  createItem: (query: string) => string;
  found: (count: number) => string;
  unresolvedBody: (title: string) => string;
  existingBody: (title: string) => string;
  createPage: string;
  ambiguousBody: (title: string) => string;
  inTrash: string;
  pickerLabel: string;
}

export type { PageSuggestion };
