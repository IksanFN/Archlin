// Only the comma decimal separator is accepted; a dot or exponent form would make "1.000" ambiguous for Indonesian readers.
const NUMBER_PATTERN = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

export function parseNumberInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };
  if (!NUMBER_PATTERN.test(text)) return { ok: false };
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}
