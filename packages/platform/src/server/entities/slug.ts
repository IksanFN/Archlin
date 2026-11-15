export function slugCandidate(name: string): string {
  const dashed = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = dashed.slice(0, 48).replace(/-$/, '');
  return cut === '' ? 'space' : cut;
}

export function nextFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
