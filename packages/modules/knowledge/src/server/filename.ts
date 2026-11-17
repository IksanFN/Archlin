const MAX_CODE_POINTS = 255;
const MAX_EXTENSION_CHARS = 16;
const FALLBACK = 'lampiran';

// The name is data for display and download headers, never a path. Both separators are cut because a client on
// Windows sends backslashes and the server must not trust which one it was.
export function normalizeFilename(raw: string): string {
  const lastSeparator = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  const name = raw
    .slice(lastSeparator + 1)
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name === '') return FALLBACK;

  const points = [...name];
  if (points.length <= MAX_CODE_POINTS) return name;

  // Keep a short real extension so a long name still opens with the right program.
  const dot = points.lastIndexOf('.');
  const extension = dot > 0 && points.length - dot - 1 <= MAX_EXTENSION_CHARS ? points.slice(dot) : [];
  const base = (extension.length > 0 ? points.slice(0, dot) : points).slice(0, MAX_CODE_POINTS - extension.length);
  return [...base, ...extension].join('').trim();
}
