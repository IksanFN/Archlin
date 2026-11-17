import { textExtractorContract } from '@archlin/testing/contracts';
import { docxFixture, pdfFixture, utf8, zipFixture } from '@archlin/testing/files';
import { describe, expect, it } from 'vitest';
import { DOCX_MIME } from '../../shared/attachment-kind';
import { docxExtractor, extractText, normalizeExtracted, pdfExtractor, plainTextExtractor } from './extractors';

textExtractorContract('pdf', pdfExtractor, {
  mime: 'application/pdf',
  valid: pdfFixture('Rollback Postgres'),
  expectedText: 'Rollback Postgres',
  corrupt: pdfFixture('Rollback').slice(0, 200),
});
textExtractorContract('docx', docxExtractor, {
  mime: DOCX_MIME,
  valid: docxFixture(['Langkah satu']),
  expectedText: 'Langkah satu',
  corrupt: utf8('PK bukan zip'),
});
textExtractorContract('plain', plainTextExtractor, {
  mime: 'text/plain',
  valid: utf8('halo dunia'),
  expectedText: 'halo dunia',
  corrupt: Uint8Array.of(0xff, 0xfe),
});

describe('extractText', () => {
  it('a pdf without a text layer yields no_text', async () => {
    expect(await extractText(pdfFixture(null), 'application/pdf', { maxChars: 1000 })).toEqual({ status: 'no_text' });
  });

  it('a truncated pdf fails with corrupt', async () => {
    expect(await extractText(pdfFixture('Halo').slice(0, 120), 'application/pdf', { maxChars: 1000 })).toEqual({
      status: 'failed',
      error: 'corrupt',
    });
  });

  it('a docx whose central directory exceeds the limits fails with archive_limits', async () => {
    const bomb = zipFixture([{ name: 'word/document.xml', data: utf8('<w:document/>'), declaredSize: 200_000_000 }]);
    expect(await extractText(bomb, DOCX_MIME, { maxChars: 1000 })).toEqual({ status: 'failed', error: 'archive_limits' });
  });

  it('a docx that understates its size in the central directory fails with archive_limits instead of expanding', async () => {
    const bomb = zipFixture([
      ...[
        ['[Content_Types].xml', '<Types/>'],
        ['_rels/.rels', '<Relationships/>'],
      ].map(([name, data]) => ({ name: name as string, data: utf8(data as string) })),
      { name: 'word/document.xml', data: new Uint8Array(30_000_000), deflate: true, declaredSize: 1000 },
    ]);
    expect(await extractText(bomb, DOCX_MIME, { maxChars: 1000 })).toEqual({ status: 'failed', error: 'archive_limits' });
  });

  it('a docx with more entries than the limit fails with archive_limits', async () => {
    const many = zipFixture(Array.from({ length: 5001 }, (_, index) => ({ name: `e${index}`, data: utf8('x') })));
    expect(await extractText(many, DOCX_MIME, { maxChars: 1000 })).toEqual({ status: 'failed', error: 'archive_limits' });
  });

  it('a docx with several paragraphs keeps them on separate lines', async () => {
    expect(await extractText(docxFixture(['Satu', 'Dua']), DOCX_MIME, { maxChars: 1000 })).toEqual({
      status: 'done',
      text: 'Satu\n\nDua',
    });
  });

  it('a docx with no text yields no_text', async () => {
    expect(await extractText(docxFixture(['  ']), DOCX_MIME, { maxChars: 1000 })).toEqual({ status: 'no_text' });
  });

  it('plain text that is only whitespace yields no_text', async () => {
    expect(await extractText(utf8('  \n\t '), 'text/markdown', { maxChars: 1000 })).toEqual({ status: 'no_text' });
  });

  it('a type no extractor reads fails with corrupt', async () => {
    expect(await extractText(utf8('x'), 'application/zip', { maxChars: 1000 })).toEqual({ status: 'failed', error: 'corrupt' });
  });
});

describe('normalizeExtracted', () => {
  it('uses unix line breaks, drops NUL, trims and cuts at maxChars', () => {
    expect(normalizeExtracted('\r\n a\u0000b\r\nc \r\n', 100)).toBe('ab\nc');
    expect(normalizeExtracted('abcdef', 3)).toBe('abc');
  });

  it('never leaves half of a surrogate pair', () => {
    const cut = normalizeExtracted('😀😀', 3);
    expect(cut.isWellFormed()).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(3);
  });
});
