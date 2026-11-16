import type { AttachmentView } from '@archlin/modules-knowledge/shared';
import { KnowledgeClientError } from '@archlin/modules-knowledge/web';
import type { UploadFileInput, UploadFileResult } from '@archlin/modules-knowledge/web';
import { z } from 'zod';

const attachmentSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  filename: z.string(),
  mime: z.string(),
  size: z.number(),
  kind: z.enum(['image', 'pdf', 'file']),
  extraction: z.enum(['pending', 'done', 'no_text', 'unsupported', 'failed']),
  referenced: z.boolean(),
  trashed: z.boolean(),
  createdAt: z.string(),
}) satisfies z.ZodType<AttachmentView>;

const successSchema = z.object({ attachment: attachmentSchema });

const failureSchema = z.object({
  error: z.object({ code: z.string(), message: z.string().optional(), details: z.unknown().optional() }),
});

// The name travels percent-encoded because header values are not UTF-8 safe; the browser type is only a hint for the server.
export function uploadHeaders(input: { pageId: string; uploadId: string; file: { name: string; type: string } }): Record<string, string> {
  return {
    'x-archlin-page': input.pageId,
    'x-archlin-upload-id': input.uploadId,
    'x-archlin-filename': encodeURIComponent(input.file.name),
    ...(input.file.type === '' ? {} : { 'content-type': input.file.type }),
  };
}

const abortError = () => new DOMException('Upload aborted', 'AbortError');

function failureOf(xhr: XMLHttpRequest): KnowledgeClientError {
  const requestId = xhr.getResponseHeader('x-request-id');
  let body: unknown = null;
  try {
    body = JSON.parse(xhr.responseText);
  } catch {
    // A proxy error page is not JSON; the status alone describes it.
  }
  const parsed = failureSchema.safeParse(body);
  if (!parsed.success) return new KnowledgeClientError({ code: 'unknown', message: `HTTP ${xhr.status}`, status: xhr.status, requestId });
  const { code, message, details } = parsed.data.error;
  return new KnowledgeClientError({ code, message: message ?? code, status: xhr.status, details, requestId });
}

// XMLHttpRequest and not fetch: fetch reports no upload progress, and the file is sent as the raw body so nothing is buffered.
export function uploadFile(input: UploadFileInput, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<UploadFileResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const settle = () => signal.removeEventListener('abort', abort);

    xhr.open('POST', '/files');
    for (const [name, value] of Object.entries(uploadHeaders(input))) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      settle();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(failureOf(xhr));
        return;
      }
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Falls through to the unknown-response error below.
      }
      const parsed = successSchema.safeParse(body);
      if (!parsed.success) {
        reject(new KnowledgeClientError({ code: 'unknown', message: 'Unexpected upload response', status: xhr.status }));
        return;
      }
      resolve({ attachment: parsed.data.attachment, created: xhr.status === 201 });
    };
    xhr.onerror = () => {
      settle();
      reject(new KnowledgeClientError({ code: 'network', message: 'network', status: 0 }));
    };
    xhr.onabort = () => {
      settle();
      reject(abortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(input.file);
  });
}
