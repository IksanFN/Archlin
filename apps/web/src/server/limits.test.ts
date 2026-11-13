import { describe, expect, it } from 'vitest';
import { bodyLimitFor } from './limits';

describe('bodyLimitFor', () => {
  it('allows 5 MB only for the page save functions', () => {
    expect(bodyLimitFor('/_serverFn/kb-save-page')).toBe(5_242_880);
    expect(bodyLimitFor('/_serverFn/kb-overwrite-page')).toBe(5_242_880);
    expect(bodyLimitFor('/_serverFn/kb-save-page-x')).toBe(1_048_576);
    expect(bodyLimitFor('/_serverFn/abc123')).toBe(1_048_576);
    expect(bodyLimitFor('/api/capture')).toBe(1_048_576);
  });
});
