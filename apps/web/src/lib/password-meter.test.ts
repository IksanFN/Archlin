import { describe, expect, it } from 'vitest';
import { passwordMeter } from './password-meter';

describe('passwordMeter', () => {
  it.each([
    ['', 0, false, '0 dari 12 karakter minimum'],
    ['abcd', 1, false, '4 dari 12 karakter minimum'],
    ['abcdefgh', 2, false, '8 dari 12 karakter minimum'],
    ['abcdefghijk', 3, false, '11 dari 12 karakter minimum'],
    ['abcdefghijkl', 4, true, 'Panjang cukup'],
    ['abcdefghijklmnopqrstuvwxyz', 4, true, 'Panjang cukup'],
  ])('measures %j as %i segments (sufficient=%s)', (value, segments, sufficient, text) => {
    expect(passwordMeter(value)).toEqual({ segments, sufficient, text });
  });

  it('counts characters the way the server does, not UTF-16 units', () => {
    // Twelve emoji are 24 UTF-16 units but 12 characters.
    expect(passwordMeter('😀'.repeat(12)).sufficient).toBe(true);
    expect(passwordMeter('😀'.repeat(11)).sufficient).toBe(false);
  });

  it('treats composed and decomposed accents as the same length', () => {
    const decomposed = 'é'.repeat(12);
    expect(passwordMeter(decomposed).sufficient).toBe(true);
  });
});
