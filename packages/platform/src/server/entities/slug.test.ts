import { describe, expect, it } from 'vitest';
import { nextFreeSlug, slugCandidate } from './slug';

describe('slugCandidate', () => {
  it('slugCandidate strips diacritics and symbols', () => {
    expect(slugCandidate('Kérja Tim!')).toBe('kerja-tim');
    expect(slugCandidate('🚀')).toBe('space');
    expect(slugCandidate('   ')).toBe('space');
    expect(slugCandidate('a'.repeat(30) + ' ' + 'b'.repeat(30))).toMatch(/^[a-z0-9-]{1,48}$/);
    expect(slugCandidate('a'.repeat(47) + ' bc').endsWith('-')).toBe(false);
  });
});

describe('nextFreeSlug', () => {
  it('nextFreeSlug takes the first free suffix', () => {
    expect(nextFreeSlug('kerja', new Set(['kerja', 'kerja-2']))).toBe('kerja-3');
    expect(nextFreeSlug('kerja', new Set())).toBe('kerja');
  });
});
