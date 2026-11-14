import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, sanitizePastedContent } from './markdown-paste';

describe('markdown paste', () => {
  it('detects headings, lists, quotes, fences and tables', () => {
    expect(looksLikeMarkdown('# judul')).toBe(true);
    expect(looksLikeMarkdown('## judul')).toBe(true);
    expect(looksLikeMarkdown('- item')).toBe(true);
    expect(looksLikeMarkdown('* item')).toBe(true);
    expect(looksLikeMarkdown('+ item')).toBe(true);
    expect(looksLikeMarkdown('1. item')).toBe(true);
    expect(looksLikeMarkdown('> kutipan')).toBe(true);
    expect(looksLikeMarkdown('- [ ] tugas')).toBe(true);
    expect(looksLikeMarkdown('- [x] selesai')).toBe(true);
    expect(looksLikeMarkdown('```js\nconst x = 1\n```')).toBe(true);
    expect(looksLikeMarkdown('| a | b |\n| --- | --- |')).toBe(true);
    expect(looksLikeMarkdown('|a|b|\n|:---:|---:|')).toBe(true);
  });

  it('plain prose is not markdown', () => {
    expect(looksLikeMarkdown('hanya kalimat biasa')).toBe(false);
    expect(looksLikeMarkdown('satu\ndua\ntiga')).toBe(false);
    expect(looksLikeMarkdown('#tanpa spasi')).toBe(false);
  });
});

describe('sanitizePastedContent', () => {
  it('drops only unsafe images and links', () => {
    const result = sanitizePastedContent([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
        ],
      },
      { type: 'image', attrs: { src: 'https://contoh.id/a.png' } },
      { type: 'image', attrs: { src: 'http://contoh.id/b.png' } },
    ]);
    expect(result).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
      { type: 'image', attrs: { src: 'https://contoh.id/a.png' } },
    ]);
  });

  it('keeps a safe link and accepts a single node', () => {
    const link = { type: 'link', attrs: { href: 'https://contoh.id' } };
    const result = sanitizePastedContent({
      type: 'paragraph',
      content: [{ type: 'text', text: 'b', marks: [link] }],
    });
    expect(result).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'b', marks: [link] }] }]);
  });
});
