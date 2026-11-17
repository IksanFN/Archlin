import { describe, expect, it } from 'vitest';
import { shouldSnapshot } from './snapshot-policy';

describe('shouldSnapshot', () => {
  it.each([
    ['idle', 11, 'a', 'b', true],
    ['idle', 9, 'a', 'b', false],
    ['idle', 11, 'a', 'a', false],
    ['leave', 0, 'a', 'b', true],
    ['manual', 0, 'a', 'a', false],
    ['pre_restore', 0, 'a', null, true],
  ] as const)('%s after %i minutes', (reason, minutes, current, last, expected) => {
    const lastSavedAt = new Date('2026-11-16T01:00:00Z');
    const now = new Date(lastSavedAt.getTime() + minutes * 60_000);
    expect(shouldSnapshot({ reason, now, lastSavedAt, currentHash: current, lastSnapshotHash: last })).toBe(expected);
  });

  it('idle needs strictly more than ten minutes', () => {
    const lastSavedAt = new Date('2026-11-16T01:00:00Z');
    const now = new Date(lastSavedAt.getTime() + 600_000);
    expect(shouldSnapshot({ reason: 'idle', now, lastSavedAt, currentHash: 'a', lastSnapshotHash: 'b' })).toBe(false);
  });
});
