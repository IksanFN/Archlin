import { describe, expect, it } from 'vitest';
import { parseDocument } from './document';
import { documentLinkRefs } from './links';

const ID = '0197b2a0-0000-7000-8000-000000000001';
const text = (value: string) => ({ type: 'text', text: value });
const wiki = (entityId: string | null, title: string) => ({ type: 'wikiLink', attrs: { entityId, title } });
const mention = (entityId: string, title: string) => ({ type: 'mention', attrs: { entityId, title } });
const para = (inline: unknown[]) => ({ type: 'paragraph', content: inline });
const doc = (...blocks: unknown[]) => parseDocument({ type: 'doc', content: blocks });

describe('documentLinkRefs', () => {
  it('returns refs in document order with a bounded snippet', () => {
    const long = 'x '.repeat(200);
    const refs = documentLinkRefs(
      doc(para([text(long), wiki(null, 'Deploy'), text(' selesai')]), para([mention(ID, 'Rudi')])),
    );
    expect(refs.map((ref) => [ref.kind, ref.targetId, ref.targetTitle])).toEqual([
      ['wikilink', null, 'Deploy'],
      ['mention', ID, 'Rudi'],
    ]);
    expect(refs[0]?.snippet.startsWith('…')).toBe(true);
    expect(refs[0]?.snippet).toContain('[[Deploy]] selesai');
    expect(refs[0]?.snippet.length).toBeLessThanOrEqual(240);
    expect(refs[1]?.snippet).toBe('@Rudi');
  });

  it('keeps a short paragraph whole and writes a mention as @title', () => {
    const refs = documentLinkRefs(doc(para([text('Tanya '), mention(ID, 'Rudi'), text(' soal [[Deploy]]?')])));
    expect(refs[0]?.snippet).toBe('Tanya @Rudi soal [[Deploy]]?');
  });

  it('cuts the window at word boundaries on both sides', () => {
    const before = 'kata '.repeat(60);
    const after = ' kata'.repeat(60);
    const [ref] = documentLinkRefs(doc(para([text(before), wiki(null, 'Deploy'), text(after)])));
    const snippet = ref?.snippet ?? '';
    expect(snippet.startsWith('…kata ')).toBe(true);
    expect(snippet.endsWith(' kata…')).toBe(true);
    expect(snippet).toContain('[[Deploy]]');
  });

  it('finds links nested in lists and callouts and returns nothing when there are none', () => {
    const nested = doc({
      type: 'callout',
      attrs: { variant: 'info' },
      content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [para([wiki(null, 'Dalam')])] }] }],
    });
    expect(documentLinkRefs(nested).map((ref) => ref.targetTitle)).toEqual(['Dalam']);
    expect(documentLinkRefs(doc(para([text('polos')])))).toEqual([]);
  });
});
