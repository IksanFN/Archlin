// The shape Playwright's setInputFiles takes for a file that exists only in memory.
export function filePayload(name: string, mimeType: string, bytes: Uint8Array): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType, buffer: Buffer.from(bytes) };
}
