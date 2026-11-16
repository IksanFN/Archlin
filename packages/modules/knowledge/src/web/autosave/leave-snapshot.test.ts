import { describe, expect, it } from 'vitest';
import { leaveSnapshotAllowed } from './leave-snapshot';

describe('leaveSnapshotAllowed', () => {
  it.each([
    ['idle', false, true],
    ['saved', false, true],
    ['dirty', false, false],
    ['error', false, false],
    ['conflict', false, false],
    ['saved', true, false],
  ] as const)('leaveSnapshotAllowed(%s, trashed=%s)', (status, trashed, expected) => {
    expect(leaveSnapshotAllowed(status, trashed)).toBe(expected);
  });
});
