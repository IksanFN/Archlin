import { ValidationError } from '@archlin/kernel';
import type { Logger, OwnerUnitOfWork } from '@archlin/kernel';
import { ATTACHMENT_MAX_BYTES } from '@archlin/modules-knowledge/shared';
import type { KnowledgeApi } from '@archlin/modules-knowledge/server';
import { blobKey } from '@archlin/platform/contracts';
import { FileMissingError, FileTooLargeError, StorageUnavailableError } from '@archlin/platform/server';
import type { AuthContext, FileStorage, StagedFile } from '@archlin/platform/server';
import { z } from 'zod';
import { getContainer } from './container';
import { AppError } from './errors';

// Upload and download of attachment bytes (spec 10.7). Both routes take the raw request so the file is never buffered:
// the upload streams into staging and the download streams out of storage.

export interface FileRouteDeps {
  uow: OwnerUnitOfWork;
  knowledge: KnowledgeApi;
  files: FileStorage;
  logger: Logger;
  maxBytes: number;
}

export function fileRouteDeps(): FileRouteDeps {
  const { uow, knowledge, files, logger } = getContainer();
  return { uow, knowledge, files, logger, maxBytes: ATTACHMENT_MAX_BYTES };
}

interface RouteArgs {
  request: Request;
  auth: AuthContext;
}

const uploadHeadersSchema = z.strictObject({
  pageId: z.uuid(),
  uploadId: z.uuid(),
  filename: z.string().min(1),
});

const DOWNLOAD_PATH = /^\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// Done here and not in toAppError: that module also reaches the browser, and the platform server entry must not.
function asAppError(err: unknown): unknown {
  if (err instanceof FileTooLargeError) return new AppError({ code: err.code, message: 'File terlalu besar', status: 413 });
  if (err instanceof FileMissingError) return new AppError({ code: err.code, message: 'File tidak ditemukan di penyimpanan', status: 404 });
  if (err instanceof StorageUnavailableError) {
    return new AppError({ code: err.code, message: 'Penyimpanan file sedang tidak tersedia', status: 503 });
  }
  return err;
}

const invalidUpload = () => new ValidationError('invalid_upload', 'Unggahan tidak valid');

// The filename travels percent-encoded because header values are not UTF-8 safe.
function readUploadHeaders(request: Request): z.infer<typeof uploadHeadersSchema> {
  const encoded = request.headers.get('x-archlin-filename') ?? '';
  let filename: string;
  try {
    filename = decodeURIComponent(encoded);
  } catch {
    throw invalidUpload();
  }
  const parsed = uploadHeadersSchema.safeParse({
    pageId: request.headers.get('x-archlin-page'),
    uploadId: request.headers.get('x-archlin-upload-id'),
    filename,
  });
  if (!parsed.success) throw invalidUpload();
  return parsed.data;
}

function declaredMimeOf(request: Request): string | null {
  const value = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return value === undefined || value === '' ? null : value;
}

const emptyBody = (): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.close();
    },
  });

export async function handleUpload({ request, auth }: RouteArgs, deps: FileRouteDeps): Promise<Response> {
  const { uow, knowledge, files, logger, maxBytes } = deps;
  const { pageId, uploadId, filename } = readUploadHeaders(request);
  const declaredMime = declaredMimeOf(request);

  let staged: StagedFile | undefined;
  try {
    const file = await files.stage(request.body ?? emptyBody(), { maxBytes });
    staged = file;
    if (file.size === 0) throw new ValidationError('file_empty', 'File kosong');
    const { attachment, created } = await uow.write(auth.scope, (tx) =>
      knowledge.attachments.register(tx, { pageId, uploadId, filename, declaredMime, staged: file }),
    );
    // The name, page and type identify what the owner keeps, so only the size and the outcome are logged (K7).
    logger.info({ size: file.size, created }, 'attachment uploaded');
    return Response.json({ attachment }, { status: created ? 201 : 200, headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    throw asAppError(err);
  } finally {
    // After a successful register the file already moved to its blob key and this finds nothing to remove.
    if (staged !== undefined) await files.discard(staged);
  }
}

const encodeRfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

// filename carries a printable-ASCII fallback for old clients, filename* the real UTF-8 name (RFC 6266, RFC 5987).
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const fallback = [...filename].map((char) => (/^[\x20-\x7e]$/.test(char) && char !== '"' && char !== '\\' ? char : '_')).join('');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

const notFound = () => new AppError({ code: 'attachment_not_found', message: 'Lampiran tidak ditemukan', status: 404 });

export async function handleDownload({ request, auth }: RouteArgs, deps: FileRouteDeps): Promise<Response> {
  const { uow, knowledge, files, logger } = deps;
  const url = new URL(request.url);
  const attachmentId = DOWNLOAD_PATH.exec(url.pathname)?.[1];
  if (attachmentId === undefined) throw notFound();

  const file = await uow.read(auth.scope, (tx) => knowledge.attachments.file(tx, attachmentId));
  let body: ReadableStream<Uint8Array>;
  try {
    body = await files.read(blobKey(auth.scope.ownerId, file.sha256));
  } catch (err) {
    if (err instanceof FileMissingError) logger.error({ attachmentId }, 'attachment file is missing from storage');
    throw asAppError(err);
  }

  // Only types a browser can show without running anything are ever inline; everything else is downloaded as opaque bytes.
  const inline = (file.kind === 'image' || file.kind === 'pdf') && url.searchParams.get('download') !== '1';
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': inline ? file.mime : 'application/octet-stream',
      'content-disposition': contentDisposition(inline ? 'inline' : 'attachment', file.filename),
      'content-length': String(file.size),
      'cache-control': 'private, no-store',
    },
  });
}
