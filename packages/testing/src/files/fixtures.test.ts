import { describe, expect, it } from 'vitest';
import { docxFixture, PNG_BYTES, PNG_HEAD, pdfFixture, utf8, zipFixture } from './fixtures';

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

describe('pdfFixture', () => {
  it('is a one page PDF 1.4 whose xref offsets point at each object', () => {
    const body = text(pdfFixture('Halo'));
    expect(body.startsWith('%PDF-1.4')).toBe(true);
    expect(body.trimEnd().endsWith('%%EOF')).toBe(true);

    const xref = body.slice(body.indexOf('xref\n'));
    const entries = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(entries.length).toBeGreaterThanOrEqual(4);
    entries.forEach((offset, index) => {
      expect(body.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
    expect(Number(/startxref\n(\d+)\n/.exec(body)?.[1])).toBe(body.indexOf('xref\n'));
  });

  it('carries the text in a content stream and leaves it out for null', () => {
    expect(text(pdfFixture('Halo (dunia)'))).toContain(String.raw`(Halo \(dunia\)) Tj`);
    expect(text(pdfFixture(null))).not.toContain('Tj');
  });
});

describe('zipFixture', () => {
  it('stores entries with the CRC32 of their bytes', () => {
    const view = new DataView(zipFixture([{ name: 'a', data: utf8('abc') }]).buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(0x352441c2);
  });

  it('declaredSize only changes the size in the central directory', () => {
    const bytes = zipFixture([{ name: 'a', data: utf8('abc'), declaredSize: 99 }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(22, true)).toBe(3);
    const central = text(bytes).indexOf('PK\u0001\u0002');
    expect(view.getUint32(central + 24, true)).toBe(99);
  });
});

describe('docxFixture and PNG', () => {
  it('a docx is a zip that holds the three required parts and the paragraphs', () => {
    const body = text(docxFixture(['Satu', 'Dua & tiga']));
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) expect(body).toContain(part);
    expect(body).toContain('<w:t>Satu</w:t>');
    expect(body).toContain('<w:t>Dua &amp; tiga</w:t>');
  });

  it('PNG_BYTES carries the PNG signature and PNG_HEAD is a prefix of it', () => {
    expect([...PNG_BYTES.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(Buffer.from(PNG_BYTES).subarray(0, PNG_HEAD.length).equals(Buffer.from(PNG_HEAD))).toBe(true);
  });
});
