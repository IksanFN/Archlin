import { describe, expect, it } from 'vitest';
import { systemIds } from './ids';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('systemIds', () => {
  it('produces RFC 9562 version 7 identifiers', () => {
    expect(systemIds.uuidv7()).toMatch(UUID_V7);
  });

  it('produces identifiers that sort in creation order', () => {
    const ids = Array.from({ length: 50 }, () => systemIds.uuidv7());
    expect([...ids].sort()).toEqual(ids);
  });
});
