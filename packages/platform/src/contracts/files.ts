// Staging files live beside the blobs under this prefix so one volume holds both and a rename between them is atomic.
export const STAGING_PREFIX = '.staging';

// Content-addressed and per owner: the same bytes uploaded by two owners are two blobs, and a purge never crosses owners.
export function blobKey(ownerId: string, sha256: string): string {
  return `blobs/${ownerId}/${sha256.slice(0, 2)}/${sha256}`;
}

// Fixed codes only: a library error message could quote the file, so it never reaches a row or a log (K7).
export type ExtractionErrorCode = 'timeout' | 'crashed' | 'corrupt' | 'archive_limits' | 'blob_missing';

export type ExtractResult =
  | { status: 'done'; text: string }
  | { status: 'no_text' }
  | { status: 'failed'; error: ExtractionErrorCode };

// A module supplies one per file type. The runner enforces the time limit, so an extractor only has to return.
export interface TextExtractor {
  supports(mime: string): boolean;
  extract(bytes: Uint8Array, limits: { maxChars: number }): Promise<ExtractResult>;
}
