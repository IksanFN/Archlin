import { describe, expect, it } from 'vitest';
import { parseNumberInput } from './number-field';

describe('parseNumberInput', () => {
  it('empty input clears the value', () => {
    expect(parseNumberInput('')).toEqual({ ok: true, value: null });
    expect(parseNumberInput('   ')).toEqual({ ok: true, value: null });
  });

  it('accepts a comma decimal', () => {
    expect(parseNumberInput('1,5')).toEqual({ ok: true, value: 1.5 });
    expect(parseNumberInput('-42')).toEqual({ ok: true, value: -42 });
  });

  it('rejects text and infinity', () => {
    expect(parseNumberInput('abc')).toEqual({ ok: false });
    expect(parseNumberInput('1e999')).toEqual({ ok: false });
    expect(parseNumberInput('Infinity')).toEqual({ ok: false });
    expect(parseNumberInput('1,2,3')).toEqual({ ok: false });
  });
});
