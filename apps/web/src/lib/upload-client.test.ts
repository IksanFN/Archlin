import { KnowledgeClientError } from '@archlin/modules-knowledge/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadFile, uploadHeaders } from './upload-client';

class FakeXhr {
  static last: FakeXhr;
  readonly upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  method = '';
  url = '';
  body: unknown = null;
  readonly sent: Record<string, string> = {};
  responseHeaders: Record<string, string> = {};

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.sent[name.toLowerCase()] = value;
  }
  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }
  send(body: unknown): void {
    this.body = body;
    FakeXhr.last = this;
  }
  abort(): void {
    this.onabort?.();
  }
  respond(status: number, body: unknown, headers: Record<string, string> = {}): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.responseHeaders = headers;
    this.onload?.();
  }
}

const file = () => new File(['isi'], 'catatan ü.txt', { type: 'text/plain' });
const input = () => ({ pageId: 'p1', uploadId: 'u1', file: file() });
const attachment = {
  id: 'a1',
  pageId: 'p1',
  filename: 'catatan ü.txt',
  mime: 'text/plain',
  size: 3,
  kind: 'file',
  extraction: 'pending',
  referenced: false,
  trashed: false,
  createdAt: '2026-11-16T00:00:00.000Z',
} as const;

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadHeaders', () => {
  it('encodes the file name and omits an empty type', () => {
    expect(uploadHeaders({ pageId: 'p', uploadId: 'u', file: { name: 'catatan ü.txt', type: '' } })).toEqual({
      'x-archlin-page': 'p',
      'x-archlin-upload-id': 'u',
      'x-archlin-filename': 'catatan%20%C3%BC.txt',
    });
  });

  it('sends the declared type when the browser knows it', () => {
    expect(uploadHeaders({ pageId: 'p', uploadId: 'u', file: { name: 'a.pdf', type: 'application/pdf' } })['content-type']).toBe(
      'application/pdf',
    );
  });
});

describe('uploadFile', () => {
  it('posts the raw file to /files with the upload headers and resolves with the attachment', async () => {
    const progress: number[] = [];
    const pending = uploadFile(input(), (fraction) => progress.push(fraction), new AbortController().signal);
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/files');
    expect(xhr.sent['x-archlin-upload-id']).toBe('u1');
    expect(xhr.body).toBeInstanceOf(File);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.respond(201, { attachment });
    await expect(pending).resolves.toEqual({ attachment, created: true });
    expect(progress).toEqual([0.25]);
  });

  it('reports a repeated upload id answered with 200 as not created', async () => {
    const pending = uploadFile(input(), () => {}, new AbortController().signal);
    FakeXhr.last.respond(200, { attachment });
    await expect(pending).resolves.toEqual({ attachment, created: false });
  });

  it('turns a failure response into a client error with the server code and request id', async () => {
    const pending = uploadFile(input(), () => {}, new AbortController().signal);
    FakeXhr.last.respond(413, { error: { code: 'file_too_large', message: 'File terlalu besar', details: null } }, { 'x-request-id': 'req-9' });
    await expect(pending).rejects.toMatchObject({ code: 'file_too_large', status: 413, requestId: 'req-9' });
    await pending.catch((error: unknown) => expect(error).toBeInstanceOf(KnowledgeClientError));
  });

  it('keeps an unreadable failure body as an unknown error with its status', async () => {
    const pending = uploadFile(input(), () => {}, new AbortController().signal);
    const xhr = FakeXhr.last;
    xhr.status = 502;
    xhr.responseText = '<html>bad gateway</html>';
    xhr.onload?.();
    await expect(pending).rejects.toMatchObject({ code: 'unknown', status: 502 });
  });

  it('rejects a success response that is not an attachment instead of passing it on', async () => {
    const pending = uploadFile(input(), () => {}, new AbortController().signal);
    FakeXhr.last.respond(201, { attachment: { id: 'a1' } });
    await expect(pending).rejects.toMatchObject({ code: 'unknown', status: 201 });
  });

  it('reports a network failure with code network and status 0', async () => {
    const pending = uploadFile(input(), () => {}, new AbortController().signal);
    FakeXhr.last.onerror?.();
    await expect(pending).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('aborts the request and rejects with an AbortError when the signal fires', async () => {
    const controller = new AbortController();
    const pending = uploadFile(input(), () => {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects at once when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadFile(input(), () => {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
