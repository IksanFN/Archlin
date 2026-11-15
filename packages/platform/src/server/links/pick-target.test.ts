import { describe, expect, it } from 'vitest';
import { pickTarget } from './pick-target';

describe('pickTarget', () => {
  it('prefers the source space and refuses an ambiguous title', () => {
    expect(pickTarget([{ id: 'a', spaceId: 's1' }, { id: 'b', spaceId: 's2' }], 's1')).toBe('a');
    expect(pickTarget([{ id: 'a', spaceId: 's1' }, { id: 'b', spaceId: 's1' }], 's1')).toBeNull();
    expect(pickTarget([{ id: 'b', spaceId: 's2' }], 's1')).toBe('b');
    expect(pickTarget([{ id: 'b', spaceId: 's2' }, { id: 'c', spaceId: 's3' }], 's1')).toBeNull();
    expect(pickTarget([], 's1')).toBeNull();
  });
});
