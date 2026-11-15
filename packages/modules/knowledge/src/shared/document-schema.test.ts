import type { TagParseRule } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { getDocumentSchema, isAllowedImageSrc, isAllowedLink } from './document-schema';

describe('document schema', () => {
  it('heading level 1 renders as h2', () => {
    const heading = getDocumentSchema().nodes.heading;
    if (heading === undefined) throw new Error('heading node missing');
    const spec = heading.spec.toDOM?.(heading.create({ level: 1 }));
    expect(Array.isArray(spec) ? spec[0] : spec).toBe('h2');
  });

  it('h1 and h2 parse to level 1', () => {
    const rules = (getDocumentSchema().nodes.heading?.spec.parseDOM ?? []) as TagParseRule[];
    const levelFor = (tag: string) => rules.find((rule) => rule.tag === tag)?.attrs?.level;
    expect(levelFor('h1')).toBe(1);
    expect(levelFor('h2')).toBe(1);
  });

  it('the schema has every block the editor offers', () => {
    const schema = getDocumentSchema();
    for (const name of [
      'paragraph',
      'heading',
      'blockquote',
      'bulletList',
      'orderedList',
      'listItem',
      'taskList',
      'taskItem',
      'table',
      'tableRow',
      'tableCell',
      'tableHeader',
      'horizontalRule',
      'codeBlock',
      'details',
      'detailsSummary',
      'detailsContent',
      'image',
      'callout',
    ]) {
      expect(schema.nodes[name], name).toBeDefined();
    }
    for (const name of ['bold', 'italic', 'strike', 'underline', 'code', 'link']) {
      expect(schema.marks[name], name).toBeDefined();
    }
  });

  it('isAllowedLink rejects javascript and data urls', () => {
    expect(isAllowedLink('javascript:alert(1)')).toBe(false);
    expect(isAllowedLink('data:text/html,hi')).toBe(false);
    expect(isAllowedLink('https://contoh.id')).toBe(true);
    expect(isAllowedLink('http://contoh.id')).toBe(true);
    expect(isAllowedLink('mailto:ops@contoh.id')).toBe(true);
  });

  it('isAllowedImageSrc accepts https only', () => {
    expect(isAllowedImageSrc('https://cdn.contoh.id/x.png')).toBe(true);
    expect(isAllowedImageSrc('http://cdn.contoh.id/x.png')).toBe(false);
    expect(isAllowedImageSrc('data:image/png;base64,aaaa')).toBe(false);
  });
});

describe('link nodes', () => {
  it('the document schema has wikiLink and mention as inline atoms', () => {
    const schema = getDocumentSchema();
    expect(schema.nodes.wikiLink?.isAtom && schema.nodes.wikiLink.isInline).toBe(true);
    expect(schema.nodes.mention?.isAtom && schema.nodes.mention.isInline).toBe(true);
    expect(Object.keys(schema.nodes.wikiLink?.spec.attrs ?? {})).toEqual(['entityId', 'title']);
    expect(Object.keys(schema.nodes.mention?.spec.attrs ?? {})).toEqual(['entityId', 'title']);
  });

  it('wikiLink parses its id and title back from the rendered anchor', () => {
    const rules = (getDocumentSchema().nodes.wikiLink?.spec.parseDOM ?? []) as TagParseRule[];
    const rule = rules.find((candidate) => candidate.tag === 'a[data-wiki-link]');
    const anchor = (id: string | null) => ({
      getAttribute: (name: string) => (name === 'data-entity-id' ? id : null),
      textContent: 'Deploy',
    });
    const read = (element: ReturnType<typeof anchor>) =>
      (rule?.getAttrs as ((node: unknown) => Record<string, unknown> | false) | undefined)?.(element);
    expect(read(anchor('0197b2a0-0000-7000-8000-000000000001'))).toMatchObject({
      entityId: '0197b2a0-0000-7000-8000-000000000001',
      title: 'Deploy',
    });
    expect(read(anchor(''))).toMatchObject({ title: 'Deploy' });
    expect(read(anchor(''))).not.toHaveProperty('entityId');
  });

  it('mention parses its id and drops the leading at sign from the title', () => {
    const rules = (getDocumentSchema().nodes.mention?.spec.parseDOM ?? []) as TagParseRule[];
    const rule = rules.find((candidate) => candidate.tag === 'span[data-mention]');
    const span = {
      getAttribute: (name: string) => (name === 'data-entity-id' ? '0197b2a0-0000-7000-8000-000000000001' : null),
      textContent: '@Rudi',
    };
    expect((rule?.getAttrs as ((node: unknown) => Record<string, unknown> | false) | undefined)?.(span)).toMatchObject({
      entityId: '0197b2a0-0000-7000-8000-000000000001',
      title: 'Rudi',
    });
  });
});
