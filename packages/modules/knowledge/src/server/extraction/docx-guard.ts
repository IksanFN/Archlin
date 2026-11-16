// A docx is a zip, and a small zip can expand to gigabytes. The sizes the archive declares are read from its central
// directory before any decompression, so a bomb is refused while it is still a few kilobytes.
export const DOCX_LIMITS = { maxEntries: 5_000, maxUncompressed: 67_108_864, maxRatio: 100 } as const;

export interface ZipSummary {
  entries: number;
  uncompressed: number;
  maxRatio: number;
}

const END_SIGNATURE = 0x06054b50;
const ENTRY_SIGNATURE = 0x02014b50;
const END_RECORD_BYTES = 22;
const ENTRY_HEADER_BYTES = 46;
// The end record sits at the very end, behind a comment of at most 65,535 bytes.
const END_SEARCH_BYTES = 65_557;
const ZIP64_32 = 0xffffffff;
const ZIP64_16 = 0xffff;

const OVER_ANY_LIMIT: ZipSummary = { entries: Infinity, uncompressed: Infinity, maxRatio: Infinity };

function findEndRecord(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - END_SEARCH_BYTES);
  for (let at = view.byteLength - END_RECORD_BYTES; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === END_SIGNATURE) return at;
  }
  return -1;
}

// Null when the bytes are not a zip or the directory is cut short. ZIP64 sizes are not parsed: they count as over every
// limit, because no office document of the allowed size needs them.
export function inspectZip(bytes: Uint8Array): ZipSummary | null {
  if (bytes.byteLength < END_RECORD_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndRecord(view);
  if (end < 0) return null;

  const count = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (count === ZIP64_16 || directoryOffset === ZIP64_32) return OVER_ANY_LIMIT;

  let at = directoryOffset;
  let uncompressed = 0;
  let maxRatio = 0;
  for (let index = 0; index < count; index += 1) {
    if (at + ENTRY_HEADER_BYTES > view.byteLength || view.getUint32(at, true) !== ENTRY_SIGNATURE) return null;
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    if (compressedSize === ZIP64_32 || size === ZIP64_32) {
      uncompressed = Infinity;
      maxRatio = Infinity;
    } else {
      uncompressed += size;
      if (size > 0) maxRatio = Math.max(maxRatio, compressedSize === 0 ? Infinity : size / compressedSize);
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    at += ENTRY_HEADER_BYTES + nameLength + extraLength + commentLength;
  }
  return { entries: count, uncompressed, maxRatio: maxRatio === 0 ? 1 : maxRatio };
}
