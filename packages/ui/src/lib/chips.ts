export function addChips(
  values: readonly string[],
  raw: string,
  max: number,
): { values: string[]; rejected: 'limit' | null } {
  const next = [...values];
  const seen = new Set(next.map((value) => value.toLowerCase()));
  let rejected: 'limit' | null = null;
  for (const part of raw.split(',')) {
    const chip = part.trim();
    if (chip === '' || seen.has(chip.toLowerCase())) continue;
    if (next.length >= max) {
      rejected = 'limit';
      break;
    }
    next.push(chip);
    seen.add(chip.toLowerCase());
  }
  return { values: next, rejected };
}
