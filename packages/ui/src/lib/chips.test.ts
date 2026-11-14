import { describe, expect, it } from 'vitest';
import { addChips } from './chips';

describe('addChips', () => {
  it('splits on commas and trims', () => {
    expect(addChips(['a'], ' b , c,, ', 10)).toEqual({ values: ['a', 'b', 'c'], rejected: null });
  });

  it('drops case-insensitive duplicates of existing chips', () => {
    expect(addChips(['Runbook'], 'runbook, RUNBOOK, ops, Ops', 10)).toEqual({
      values: ['Runbook', 'ops'],
      rejected: null,
    });
  });

  it('stops at the limit and reports it', () => {
    expect(addChips(['a', 'b'], 'c, d, e', 3)).toEqual({ values: ['a', 'b', 'c'], rejected: 'limit' });
  });
});
