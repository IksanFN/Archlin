import type { PageSuggestion } from '@archlin/modules-knowledge/shared';
import type { LinkNodeKind } from './link-presentation';

export type PickerItem = { kind: 'page'; suggestion: PageSuggestion } | { kind: 'create'; title: string };

export function pickerItems(suggestions: readonly PageSuggestion[], query: string, trigger: LinkNodeKind): PickerItem[] {
  const items: PickerItem[] = suggestions.map((suggestion) => ({ kind: 'page', suggestion }));
  const title = query.trim();
  if (trigger !== 'wikiLink' || title === '') return items;
  const wanted = title.toLowerCase();
  if (suggestions.some((suggestion) => suggestion.title.toLowerCase() === wanted)) return items;
  return [...items, { kind: 'create', title }];
}
