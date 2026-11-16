import type { PageSuggestion } from '@archlin/modules-knowledge/shared';
import { describe, expect, it } from 'vitest';
import { pickerItems } from './picker-items';

const suggestion = (title: string): PageSuggestion => ({
  entityId: title,
  title,
  icon: null,
  spaceId: 's',
  spaceSlug: 'kerja',
  spaceName: 'Kerja',
});

describe('pickerItems', () => {
  it('offers to create a title link only for [[ when no suggestion has that exact title', () => {
    expect(pickerItems([suggestion('Deploy staging')], 'Deploy', 'wikiLink').map((item) => item.kind)).toEqual(['page', 'create']);
    expect(pickerItems([suggestion('deploy')], 'Deploy', 'wikiLink').map((item) => item.kind)).toEqual(['page']);
    expect(pickerItems([], '  ', 'wikiLink')).toEqual([]);
    expect(pickerItems([], 'Rudi', 'mention')).toEqual([]);
  });

  it('creates from the trimmed query', () => {
    expect(pickerItems([], '  Halaman Baru ', 'wikiLink')).toEqual([{ kind: 'create', title: 'Halaman Baru' }]);
  });
});
