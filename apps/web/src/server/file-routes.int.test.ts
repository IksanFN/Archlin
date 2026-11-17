import { createDatabase, createOwnerUnitOfWork } from '@archlin/db/runtime';
import { sqlFor } from '@archlin/db/scoped';
import { buildRegistry, systemIds, UnauthorizedError } from '@archlin/kernel';
import type { Logger } from '@archlin/kernel';
import { issueOwnerScope } from '@archlin/kernel/trusted';
import { createKnowledgeApi, createKnowledgeModule, seedSystemNoteTypes } from '@archlin/modules-knowledge/server';
import type { KnowledgeDatabase } from '@archlin/modules-knowledge/server';
import { knowledgeMigrations } from '@archlin/modules-knowledge/migrations';
import {
  PLATFORM_EVENTS,
  createBlobService,
  createEventPublisher,
  createLinkService,
  createLocalDiskStorage,
  createSpaceService,
  createTagService,
  createTreeService,
} from '@archlin/platform/server';
import type { AuthContext } from '@archlin/platform/server';
import { createTwoOwnerDatabase } from '@archlin/testing/db';
import type { TestDbUrls } from '@archlin/testing/db';
import { FakeClock } from '@archlin/testing/fakes';
import { StorageUnavailableError } from '@archlin/platform/server';
import { pdfFixture, utf8 } from '@archlin/testing/files';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from './cookie-names';
import { contentDisposition, handleDownload, handleUpload } from './file-routes';
import type { FileRouteDeps } from './file-routes';
import { authedStreamRoute } from './route-wrappers';
import type { RouteDeps } from './route-wrappers';

const ORIGIN = 'http://localhost:3000';
const NOW = new Date('2026-11-16T00:00:00.000Z');
const SESSIONS = new Map<string, string>();

const registry = buildRegistry([createKnowledgeModule({ ids: systemIds })], PLATFORM_EVENTS);
const clock = new FakeClock(NOW);
const publisher = createEventPublisher({ registry, ids: systemIds, clock });
const spaces = createSpaceService({ registry, ids: systemIds, clock });
const tree = createTreeService({ registry, publisher, clock, ids: systemIds });
const tags = createTagService({ tree, ids: systemIds, clock });
const links = createLinkService({ registry, ids: systemIds, clock });

let urls: TestDbUrls;
let ownerA: string;
let ownerB: string;
let db: ReturnType<typeof createDatabase>;
let uow: ReturnType<typeof createOwnerUnitOfWork>;
let filesRoot: string;
let storage: ReturnType<typeof createLocalDiskStorage>;
let knowledge: ReturnType<typeof createKnowledgeApi>;
let page: { entityId: string };
let logged: Record<string, unknown>[];
let logger: Logger;

beforeAll(async () => {
  ({ urls, ownerA, ownerB } = await createTwoOwnerDatabase({ extraSets: [knowledgeMigrations] }));
  db = createDatabase({ connectionString: urls.app, applicationName: 'file-routes-test', max: 4 });
  uow = createOwnerUnitOfWork(db);
  for (const owner of [ownerA, ownerB]) {
    await uow.write(issueOwnerScope(owner), (tx) => seedSystemNoteTypes(sqlFor<KnowledgeDatabase>(tx), owner, systemIds, NOW));
  }
  SESSIONS.set('session-a', ownerA);
  SESSIONS.set('session-b', ownerB);
  filesRoot = await mkdtemp(join(tmpdir(), 'archlin-routes-'));
  storage = createLocalDiskStorage(filesRoot);
  const blobs = createBlobService({ registry, files: storage, clock });
  knowledge = createKnowledgeApi({ tree, tags, links, blobs, publisher, clock, ids: systemIds });
});

afterAll(async () => {
  await db.destroy();
  await rm(filesRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  logged = [];
  const capture: Logger = {
    debug: () => undefined,
    info: (obj) => void logged.push({ ...obj }),
    warn: (obj) => void logged.push({ ...obj }),
    error: (obj) => void logged.push({ ...obj }),
    child: () => capture,
  };
  logger = capture;
  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    await client.query('DELETE FROM public.entities');
    await client.query('DELETE FROM public.spaces');
    await client.query('DELETE FROM public.blobs');
  } finally {
    await client.end();
  }
  const scope = issueOwnerScope(ownerA);
  const space = await uow.write(scope, (tx) => spaces.create(tx, { name: 'Basis', icon: null }));
  const quickNote = await uow.read(scope, (tx) =>
    sqlFor<KnowledgeDatabase>(tx).selectFrom('kb_note_types').select('id').where('key', '=', 'quick_note').executeTakeFirstOrThrow(),
  );
  page = await uow.write(scope, (tx) =>
    knowledge.pages.createPage(tx, { spaceId: space.id, parentId: null, noteTypeId: quickNote.id, placement: 'last', title: 'Laporan' }),
  );
});

const routeDeps: RouteDeps = {
  auth: {
    async authenticate(token): Promise<AuthContext> {
      const owner = SESSIONS.get(token);
      if (owner === undefined) throw new UnauthorizedError();
      return { scope: issueOwnerScope(owner), sessionPublicId: 'test', reauthUntil: null };
    },
    async authenticateApiToken() {
      throw new UnauthorizedError();
    },
  },
  clock,
  get logger() {
    return logger;
  },
};

const fileDeps = (maxBytes = 52_428_800): FileRouteDeps => ({ uow, knowledge, files: storage, logger, maxBytes });
const id = (): string => systemIds.uuidv7();

interface UploadOptions {
  page: string;
  uploadId: string;
  filename: string;
  body: Uint8Array;
  contentType?: string;
  maxBytes?: number;
  chunked?: boolean;
  session?: string | null;
}

async function upload(options: UploadOptions): Promise<Response> {
  const headers: Record<string, string> = {
    'x-archlin-page': options.page,
    'x-archlin-upload-id': options.uploadId,
    'x-archlin-filename': options.filename,
  };
  if (options.contentType) headers['content-type'] = options.contentType;
  const session = options.session === undefined ? 'session-a' : options.session;
  if (session !== null) headers.cookie = `${SESSION_COOKIE}=${session}`;
  const body = options.chunked
    ? new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(options.body.slice(0, 1024));
          controller.enqueue(options.body.slice(1024));
          controller.close();
        },
      })
    : options.body;
  const request = new Request(`${ORIGIN}/files`, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
  return authedStreamRoute((args) => handleUpload(args, fileDeps(options.maxBytes)), routeDeps)({ request });
}

async function download(attachmentId: string, query = '', session: string | null = 'session-a'): Promise<Response> {
  const headers: Record<string, string> = session === null ? {} : { cookie: `${SESSION_COOKIE}=${session}` };
  const request = new Request(`${ORIGIN}/files/${attachmentId}${query === '' ? '' : `?${query}`}`, { headers });
  return authedStreamRoute((args) => handleDownload(args, fileDeps()), routeDeps)({ request });
}

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;
interface UploadBody {
  attachment: { id: string; filename: string; kind: string; extraction: string };
}
interface ErrorBody {
  error: { code: string };
}

describe('upload', () => {
  it('an upload stores the file and answers 201 with the attachment', async () => {
    const res = await upload({ page: page.entityId, uploadId: id(), filename: 'laporan.pdf', body: pdfFixture('Halo') });
    expect(res.status).toBe(201);
    expect((await json<UploadBody>(res)).attachment).toMatchObject({ filename: 'laporan.pdf', kind: 'pdf', extraction: 'pending' });
  });

  it('a repeated upload with the same id answers 200 with the existing attachment', async () => {
    const uploadId = id();
    const first = await json<UploadBody>(await upload({ page: page.entityId, uploadId, filename: 'a.pdf', body: pdfFixture('Halo') }));
    const again = await upload({ page: page.entityId, uploadId, filename: 'a.pdf', body: pdfFixture('Halo') });
    expect(again.status).toBe(200);
    expect((await json<UploadBody>(again)).attachment.id).toBe(first.attachment.id);
  });

  it('the same upload id with other content answers 409 upload_conflict', async () => {
    const uploadId = id();
    await upload({ page: page.entityId, uploadId, filename: 'a.pdf', body: pdfFixture('A') });
    const res = await upload({ page: page.entityId, uploadId, filename: 'a.pdf', body: pdfFixture('B') });
    expect([res.status, (await json<ErrorBody>(res)).error.code]).toEqual([409, 'upload_conflict']);
  });

  it('an upload over the limit answers 413 file_too_large and leaves no staging file', async () => {
    const res = await upload({ page: page.entityId, uploadId: id(), filename: 'besar.bin', body: new Uint8Array(2048), maxBytes: 1024, chunked: true });
    expect([res.status, (await json<ErrorBody>(res)).error.code]).toEqual([413, 'file_too_large']);
    expect(await storage.sweepStaging(new Date(Date.now() + 60_000))).toBe(0);
  });

  it('an empty upload answers 422 file_empty and leaves no staging file', async () => {
    const res = await upload({ page: page.entityId, uploadId: id(), filename: 'kosong.txt', body: new Uint8Array(0) });
    expect([res.status, (await json<ErrorBody>(res)).error.code]).toEqual([422, 'file_empty']);
    expect(await storage.sweepStaging(new Date(Date.now() + 60_000))).toBe(0);
  });

  it('an upload with a malformed filename header answers 422 invalid_upload', async () => {
    const res = await upload({ page: page.entityId, uploadId: id(), filename: '%E0%A4%A', body: utf8('isi') });
    expect([res.status, (await json<ErrorBody>(res)).error.code]).toEqual([422, 'invalid_upload']);
  });

  it('an upload without a page or with an id that is not a uuid answers 422 invalid_upload', async () => {
    const noPage = await upload({ page: 'bukan-uuid', uploadId: id(), filename: 'a.txt', body: utf8('isi') });
    const noUpload = await upload({ page: page.entityId, uploadId: 'bukan-uuid', filename: 'a.txt', body: utf8('isi') });
    expect([noPage.status, noUpload.status]).toEqual([422, 422]);
    expect((await json<ErrorBody>(noPage)).error.code).toBe('invalid_upload');
  });

  it('an upload to a page that does not exist answers 404 and leaves no staging file', async () => {
    const res = await upload({ page: id(), uploadId: id(), filename: 'a.txt', body: utf8('isi') });
    expect([res.status, (await json<ErrorBody>(res)).error.code]).toEqual([404, 'page_not_found']);
    expect(await storage.sweepStaging(new Date(Date.now() + 60_000))).toBe(0);
  });

  it('a disk that cannot take the file answers 503 storage_unavailable without naming the cause', async () => {
    const failing = {
      ...storage,
      stage: async () => {
        throw new StorageUnavailableError(new Error('ENOSPC /secret/path'));
      },
    };
    const request = new Request(`${ORIGIN}/files`, {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE}=session-a`,
        'x-archlin-page': page.entityId,
        'x-archlin-upload-id': id(),
        'x-archlin-filename': 'a.txt',
      },
      body: utf8('isi'),
    } as RequestInit);
    const res = await authedStreamRoute((args) => handleUpload(args, { ...fileDeps(), files: failing }), routeDeps)({ request });
    const body = await res.text();
    expect([res.status, (JSON.parse(body) as ErrorBody).error.code]).toEqual([503, 'storage_unavailable']);
    expect(body).not.toContain('secret');
  });

  it('an upload without a session answers 401', async () => {
    const res = await upload({ page: page.entityId, uploadId: id(), filename: 'a.txt', body: utf8('isi'), session: null });
    expect(res.status).toBe(401);
  });

  it('the log keeps the size and whether it was new, and nothing that names the file or the page', async () => {
    const filename = 'rahasia-gaji-2026.pdf';
    await upload({ page: page.entityId, uploadId: id(), filename, body: pdfFixture('Halo') });
    const text = JSON.stringify(logged);
    expect(logged.some((entry) => entry.created === true && typeof entry.size === 'number')).toBe(true);
    expect(text).not.toContain('rahasia');
    expect(text).not.toContain(page.entityId);
    expect(text).not.toContain('application/pdf');
  });
});

describe('download', () => {
  it('download sends an encoded content-disposition for a unicode name', async () => {
    const { attachment } = await json<UploadBody>(
      await upload({ page: page.entityId, uploadId: id(), filename: encodeURIComponent('catatan 😀 ü.txt'), body: utf8('halo'), contentType: 'text/plain' }),
    );
    const res = await download(attachment.id);
    expect(res.headers.get('content-disposition')).toBe(
      "attachment; filename=\"catatan _ _.txt\"; filename*=UTF-8''catatan%20%F0%9F%98%80%20%C3%BC.txt",
    );
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(await res.text()).toBe('halo');
    expect(res.headers.get('content-length')).toBe('4');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('a pdf is served inline unless download=1 and an svg is always an octet-stream attachment', async () => {
    const pdf = (await json<UploadBody>(await upload({ page: page.entityId, uploadId: id(), filename: 'r.pdf', body: pdfFixture('Halo') }))).attachment;
    const svg = (
      await json<UploadBody>(
        await upload({
          page: page.entityId,
          uploadId: id(),
          filename: 'g.svg',
          body: utf8('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          contentType: 'image/svg+xml',
        }),
      )
    ).attachment;
    const inline = await download(pdf.id);
    expect([inline.headers.get('content-type'), inline.headers.get('content-disposition')?.split(';')[0]]).toEqual(['application/pdf', 'inline']);
    expect((await download(pdf.id, 'download=1')).headers.get('content-disposition')?.split(';')[0]).toBe('attachment');
    const svgRes = await download(svg.id);
    expect([svgRes.headers.get('content-type'), svgRes.headers.get('content-disposition')?.split(';')[0]]).toEqual(['application/octet-stream', 'attachment']);
  });

  it('download of another owner attachment answers 404', async () => {
    const { attachment } = await json<UploadBody>(await upload({ page: page.entityId, uploadId: id(), filename: 'a.pdf', body: pdfFixture('Halo') }));
    const res = await download(attachment.id, '', 'session-b');
    expect([res.status, (await json<ErrorBody>(res)).error.code]).toEqual([404, 'attachment_not_found']);
  });

  it('a path that is not a file id answers 404', async () => {
    const res = await download('bukan-uuid');
    expect([res.status, (await json<ErrorBody>(res)).error.code]).toEqual([404, 'attachment_not_found']);
  });

  it('a download without a session answers 401', async () => {
    const res = await download(id(), '', null);
    expect(res.status).toBe(401);
  });

  it('a missing blob answers 404 blob_missing and logs the attachment id only', async () => {
    const { attachment } = await json<UploadBody>(await upload({ page: page.entityId, uploadId: id(), filename: 'hilang.pdf', body: pdfFixture('Halo') }));
    const file = await uow.read(issueOwnerScope(ownerA), (tx) => knowledge.attachments.file(tx, attachment.id));
    await storage.delete(`blobs/${ownerA}/${file.sha256.slice(0, 2)}/${file.sha256}`);
    logged = [];
    const res = await download(attachment.id);
    expect([res.status, (await json<ErrorBody>(res)).error.code]).toEqual([404, 'blob_missing']);
    expect(logged).toContainEqual(expect.objectContaining({ attachmentId: attachment.id }));
    expect(JSON.stringify(logged)).not.toContain('hilang.pdf');
  });
});

describe('contentDisposition', () => {
  it('quotes the ascii fallback and percent-encodes the real name', () => {
    expect(contentDisposition('attachment', 'laporan "final".pdf')).toBe(
      "attachment; filename=\"laporan _final_.pdf\"; filename*=UTF-8''laporan%20%22final%22.pdf",
    );
  });

  it('replaces a backslash and a control character in the fallback and encodes the reserved marks', () => {
    expect(contentDisposition('inline', "a\\b\tc(1)*'.png")).toBe(
      "inline; filename=\"a_b_c(1)*'.png\"; filename*=UTF-8''a%5Cb%09c%281%29%2A%27.png",
    );
  });
});
