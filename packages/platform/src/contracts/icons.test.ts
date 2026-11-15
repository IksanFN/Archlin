import { describe, expect, it } from 'vitest';
import { isSingleEmoji } from './icons';

describe('isSingleEmoji', () => {
  it.each([
    ['🚀', true],
    ['👩‍💻', true],
    ['🇮🇩', true],
    ['a', false],
    ['🚀🚀', false],
    ['', false],
  ] as const)('isSingleEmoji(%s)', (value, ok) => {
    expect(isSingleEmoji(value)).toBe(ok);
  });
});
