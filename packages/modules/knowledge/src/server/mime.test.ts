import { docxFixture, PNG_HEAD, pdfFixture, utf8 } from '@archlin/testing/files';
import { describe, expect, it } from 'vitest';
import { classifyFile } from './mime';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('classifyFile', () => {
  it.each([
    ['png', PNG_HEAD, null, { mime: 'image/png', kind: 'image', extractable: false }],
    ['pdf', pdfFixture('Halo'), 'application/octet-stream', { mime: 'application/pdf', kind: 'pdf', extractable: true }],
    ['docx', docxFixture(['Halo']), null, { mime: DOCX_MIME, kind: 'file', extractable: true }],
    ['utf-8 text', utf8('halo ü'), 'text/plain', { mime: 'text/plain', kind: 'file', extractable: true }],
    ['markdown', utf8('# Judul'), 'text/markdown', { mime: 'text/markdown', kind: 'file', extractable: true }],
    [
      'utf-8 text whose last character is cut by the head size',
      utf8('halo ü').slice(0, 6),
      'text/plain',
      { mime: 'text/plain', kind: 'file', extractable: true },
    ],
    [
      'invalid utf-8 claiming text',
      Uint8Array.of(0xff, 0xfe, 0x00),
      'text/plain',
      { mime: 'application/octet-stream', kind: 'file', extractable: false },
    ],
    [
      'svg',
      utf8('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'image/svg+xml',
      { mime: 'application/octet-stream', kind: 'file', extractable: false },
    ],
    [
      'html claiming to be an image',
      utf8('<html><script>alert(1)</script></html>'),
      'image/png',
      { mime: 'application/octet-stream', kind: 'file', extractable: false },
    ],
    [
      'undeclared text',
      utf8('catatan biasa'),
      null,
      { mime: 'application/octet-stream', kind: 'file', extractable: false },
    ],
  ])('%s', async (_name, head, declared, expected) => {
    expect(await classifyFile({ head, declaredMime: declared })).toEqual(expected);
  });

  it('trusts the bytes over a declared pdf type', async () => {
    expect(await classifyFile({ head: PNG_HEAD, declaredMime: 'application/pdf' })).toMatchObject({ mime: 'image/png' });
  });
});
