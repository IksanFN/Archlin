import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../shared/canonical-json';
import { emptyDocument } from '../shared/document-schema';
import { pageStateHash, type PageState } from './hash';

const context = { summary: null, whenToUse: null, source: null, aliases: [] };

function state(title: string): PageState {
  return {
    title,
    content: emptyDocument(),
    context,
    properties: {},
    noteTypeId: '00000000-0000-0000-0000-000000000001',
  };
}

describe('page state hash', () => {
  it('canonicalJson ignores key order but keeps array order', () => {
    expect(canonicalJson({ b: 1, a: [2, 1] })).toBe(canonicalJson({ a: [2, 1], b: 1 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
    expect(canonicalJson({ nested: { b: 1, a: 2 }, keep: undefined })).toBe(canonicalJson({ nested: { a: 2, b: 1 } }));
  });

  it('pageStateHash changes when only the title changes', () => {
    const first = pageStateHash(state('Rollback Postgres 16'));
    const second = pageStateHash(state('Rollback Postgres 17'));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    expect(pageStateHash(state('Rollback Postgres 16'))).toBe(first);
  });
});
