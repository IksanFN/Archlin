// Staging files live beside the blobs under this prefix so one volume holds both and a rename between them is atomic.
export const STAGING_PREFIX = '.staging';

// Content-addressed and per owner: the same bytes uploaded by two owners are two blobs, and a purge never crosses owners.
export function blobKey(ownerId: string, sha256: string): string {
  return `blobs/${ownerId}/${sha256.slice(0, 2)}/${sha256}`;
}
