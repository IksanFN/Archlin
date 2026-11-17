import { createChildProcessRunner } from '@archlin/modules-knowledge/extraction';
import { docxFixture, pdfFixture, utf8, zipFixture } from '@archlin/testing/files';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

const streamOfBytes = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

const signal = new AbortController().signal;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// The child is the built bundle: this proves the packaged file runs without node_modules and answers in the real protocol.
beforeAll(() => {
  execFileSync('pnpm', ['--filter', '@archlin/worker', 'build'], { stdio: 'ignore', shell: process.platform === 'win32' });
}, 180_000);

const runner = () =>
  createChildProcessRunner({ entry: new URL('../dist/extract-child.mjs', import.meta.url), timeoutMs: 60_000, maxOldSpaceMb: 512 });

describe('built extraction child', () => {
  it('the built child extracts a pdf with text and reports a scanned pdf as no_text', async () => {
    expect(await runner().run({ mime: 'application/pdf', bytes: streamOfBytes(pdfFixture('Teks PDF terekstrak')) }, signal)).toEqual({
      status: 'done',
      text: 'Teks PDF terekstrak',
    });
    expect(await runner().run({ mime: 'application/pdf', bytes: streamOfBytes(pdfFixture(null)) }, signal)).toEqual({ status: 'no_text' });
  });

  it('the built child reads a docx and plain text and refuses an archive bomb', async () => {
    expect(await runner().run({ mime: DOCX_MIME, bytes: streamOfBytes(docxFixture(['Isi dokumen'])) }, signal)).toEqual({
      status: 'done',
      text: 'Isi dokumen',
    });
    expect(await runner().run({ mime: 'text/plain', bytes: streamOfBytes(utf8('halo ü')) }, signal)).toEqual({ status: 'done', text: 'halo ü' });
    const bomb = zipFixture([{ name: 'word/document.xml', data: utf8('<w:document/>'), declaredSize: 200_000_000 }]);
    expect(await runner().run({ mime: DOCX_MIME, bytes: streamOfBytes(bomb) }, signal)).toEqual({ status: 'failed', error: 'archive_limits' });
  });

  it('the built child fails with corrupt for a type it does not read and for bytes that are not text', async () => {
    expect(await runner().run({ mime: 'application/zip', bytes: streamOfBytes(utf8('x')) }, signal)).toEqual({ status: 'failed', error: 'corrupt' });
    expect(await runner().run({ mime: 'text/plain', bytes: streamOfBytes(Uint8Array.of(0xff, 0xfe)) }, signal)).toEqual({
      status: 'failed',
      error: 'corrupt',
    });
  });

  it('the built child refuses more bytes than an attachment may hold', async () => {
    const tooBig = new Uint8Array(52_428_801);
    expect(await runner().run({ mime: 'text/plain', bytes: streamOfBytes(tooBig) }, signal)).toEqual({ status: 'failed', error: 'corrupt' });
  }, 120_000);
});
