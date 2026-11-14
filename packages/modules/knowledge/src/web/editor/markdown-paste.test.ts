import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown } from './markdown-paste';

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
