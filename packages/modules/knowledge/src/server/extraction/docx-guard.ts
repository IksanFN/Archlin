import { inflateRawSync } from 'node:zlib';

// A docx is a zip, and a small zip can expand to gigabytes. The sizes the archive declares are read from its central
// directory before any decompression, so a bomb is refused while it is still a few kilobytes.
export const DOCX_LIMITS = { maxEntries: 5_000, maxUncompressed: 67_108_864, maxRatio: 100 } as const;

export interface ZipSummary {
  entries: number;
  uncompressed: number;
  maxRatio: number;
}

interface ZipEntryInfo {
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const END_SIGNATURE = 0x06054b50;
const ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_RECORD_BYTES = 22;
const ENTRY_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
// The end record sits at the very end, behind a comment of at most 65,535 bytes.
const END_SEARCH_BYTES = 65_557;
const ZIP64_32 = 0xffffffff;
const ZIP64_16 = 0xffff;
const STORED = 0;
const DEFLATED = 8;

const OVER_ANY_LIMIT: ZipSummary = { entries: Infinity, uncompressed: Infinity, maxRatio: Infinity };

function findEndRecord(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - END_SEARCH_BYTES);
  for (let at = view.byteLength - END_RECORD_BYTES; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === END_SIGNATURE) return at;
  }
  return -1;
}

const viewOf = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// 'zip64' stands for an archive this reader does not parse; null for bytes that are not a complete zip.
function readEntries(bytes: Uint8Array): ZipEntryInfo[] | 'zip64' | null {
  if (bytes.byteLength < END_RECORD_BYTES) return null;
  const view = viewOf(bytes);
  const end = findEndRecord(view);
  if (end < 0) return null;

  const count = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (count === ZIP64_16 || directoryOffset === ZIP64_32) return 'zip64';

  const entries: ZipEntryInfo[] = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + ENTRY_HEADER_BYTES > view.byteLength || view.getUint32(at, true) !== ENTRY_SIGNATURE) return null;
    entries.push({
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      localOffset: view.getUint32(at + 42, true),
    });
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    at += ENTRY_HEADER_BYTES + nameLength + extraLength + commentLength;
  }
  return entries;
}

// Null when the bytes are not a zip or the directory is cut short. ZIP64 sizes are not parsed: they count as over every
// limit, because no office document of the allowed size needs them.
export function inspectZip(bytes: Uint8Array): ZipSummary | null {
  const entries = readEntries(bytes);
  if (entries === null) return null;
  if (entries === 'zip64') return OVER_ANY_LIMIT;

  let uncompressed = 0;
  let maxRatio = 0;
  for (const entry of entries) {
    if (entry.compressedSize === ZIP64_32 || entry.size === ZIP64_32) {
      uncompressed = Infinity;
      maxRatio = Infinity;
    } else {
      uncompressed += entry.size;
      if (entry.size > 0) maxRatio = Math.max(maxRatio, entry.compressedSize === 0 ? Infinity : entry.size / entry.compressedSize);
    }
  }
  return { entries: entries.length, uncompressed, maxRatio: maxRatio === 0 ? 1 : maxRatio };
}

// The central directory is only a claim. The zip library compares it with the real size after it has inflated the whole
// entry, so an archive that understates it could still fill memory first. Here every entry is inflated with the declared
// size as the ceiling, which also settles that the declared sizes are the real ones.
export function entriesMatchDeclaredSizes(bytes: Uint8Array): boolean {
  const entries = readEntries(bytes);
  if (entries === null || entries === 'zip64') return false;
  const view = viewOf(bytes);

  for (const entry of entries) {
    const header = entry.localOffset;
    if (header + LOCAL_HEADER_BYTES > view.byteLength || view.getUint32(header, true) !== LOCAL_SIGNATURE) return false;
    const start = header + LOCAL_HEADER_BYTES + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
    const end = start + entry.compressedSize;
    if (end > view.byteLength) return false;
    const stored = bytes.subarray(start, end);

    if (entry.method === STORED) {
      if (stored.byteLength !== entry.size) return false;
    } else if (entry.method === DEFLATED) {
      try {
        // maxOutputLength throws as soon as the output would pass the ceiling, before the rest is produced.
        if (inflateRawSync(stored, { maxOutputLength: Math.max(entry.size, 1) }).byteLength !== entry.size) return false;
      } catch {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}
