import { describe, expect, it } from 'vitest';
import { singleLineTitle } from './title-input';

describe('singleLineTitle', () => {
  it('strips pasted line breaks', () => {
    expect(singleLineTitle('satu\ndua')).toBe('satudua');
    expect(singleLineTitle('satu\r\ndua\r')).toBe('satudua');
  });

  it('caps the title at 500 characters after stripping', () => {
    expect(singleLineTitle(`${'a'.repeat(499)}\nb${'c'.repeat(10)}`).length).toBe(500);
  });
});
