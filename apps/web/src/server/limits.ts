// General JSON body limit (spec 13.4 K4).
export const MAX_BODY_BYTES = 1_048_576;

// Page saves carry the document, so they get a higher cap (spec 13.4 K4).
export const LARGE_BODY_BYTES = 5_242_880;

export const LARGE_BODY_FUNCTION_IDS = {
  savePageFn: 'kb-save-page',
  saveConflictCopyFn: 'kb-save-conflict-copy',
  overwritePageFn: 'kb-overwrite-page',
} as const;

const LARGE_BODY_PATHS = new Set(Object.values(LARGE_BODY_FUNCTION_IDS).map((id) => `/_serverFn/${id}`));

export function bodyLimitFor(pathname: string): number {
  return LARGE_BODY_PATHS.has(pathname) ? LARGE_BODY_BYTES : MAX_BODY_BYTES;
}
