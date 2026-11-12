export function deriveTypeKey(name: string, taken: ReadonlySet<string>): string {
  const underscored = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const cut = underscored.slice(0, 40).replace(/_$/, '');
  // Keys must start with a letter; a leading digit or empty slug gets a tipe prefix.
  const base = cut === '' ? 'tipe' : /^\d/.test(cut) ? `tipe_${cut}` : cut;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}
