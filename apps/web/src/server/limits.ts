// General JSON body limit (spec 13.4 K4).
export const MAX_BODY_BYTES = 1_048_576;

// Page saves carry the document, so they get a higher cap (spec 13.4 K4).
export const LARGE_BODY_BYTES = 5_242_880;

export const LARGE_BODY_FUNCTION_IDS = {
  savePageFn: 'kb-save-page',
  saveConflictCopyFn: 'kb-save-conflict-copy',
  overwritePageFn: 'kb-overwrite-page',
} as const;

// Raw file bytes, not JSON: the route counts what it really reads, this only turns away an honest oversized content-length.
// vite.config.ts loads this file without the workspace packages, so the shared ATTACHMENT_MAX_BYTES is mirrored and pinned by a test.
export const FILE_UPLOAD_BYTES = 52_428_800;
const FILE_UPLOAD_PATH = '/files';

const LARGE_BODY_PATHS = new Set(Object.values(LARGE_BODY_FUNCTION_IDS).map((id) => `/_serverFn/${id}`));

export function bodyLimitFor(pathname: string): number {
  if (pathname === FILE_UPLOAD_PATH) return FILE_UPLOAD_BYTES;
  return LARGE_BODY_PATHS.has(pathname) ? LARGE_BODY_BYTES : MAX_BODY_BYTES;
}
