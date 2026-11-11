import { describe, expect, it } from 'vitest';
import { issueOwnerScope } from './trusted';

describe('issueOwnerScope', () => {
  it('issues a frozen scope for a uuid owner', () => {
    const scope = issueOwnerScope('0195f0c2-7a10-7000-8000-000000000001');
    expect(scope.ownerId).toBe('0195f0c2-7a10-7000-8000-000000000001');
    expect(Object.isFrozen(scope)).toBe(true);
  });

  it('accepts upper case hexadecimal digits', () => {
    expect(issueOwnerScope('0195F0C2-7A10-7000-8000-00000000000A').ownerId).toBe('0195F0C2-7A10-7000-8000-00000000000A');
  });

  it.each(['', 'not-a-uuid', '0195f0c2-7a10-7000-8000-00000000000', '0195f0c2-7a10-7000-8000-00000000000g'])(
    'rejects owner %j',
    (value) => {
      expect(() => issueOwnerScope(value)).toThrow(TypeError);
    },
  );
});
