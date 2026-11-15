import { PAGE_SAVE_CLIENT_MAX_BYTES, PAGE_SAVE_MAX_BYTES } from '@archlin/modules-knowledge/shared';
import { describe, expect, it } from 'vitest';
import { LARGE_BODY_BYTES, bodyLimitFor } from './limits';

describe('bodyLimitFor', () => {
  it('allows 5 MB only for the page save functions', () => {
    expect(bodyLimitFor('/_serverFn/kb-save-page')).toBe(5_242_880);
    expect(bodyLimitFor('/_serverFn/kb-overwrite-page')).toBe(5_242_880);
    expect(bodyLimitFor('/_serverFn/kb-save-page-x')).toBe(1_048_576);
    expect(bodyLimitFor('/_serverFn/abc123')).toBe(1_048_576);
    expect(bodyLimitFor('/api/capture')).toBe(1_048_576);
  });

  it('the page save body cap matches the client cap owner', () => {
    expect(LARGE_BODY_BYTES).toBe(PAGE_SAVE_MAX_BYTES);
    expect(PAGE_SAVE_CLIENT_MAX_BYTES).toBeLessThan(PAGE_SAVE_MAX_BYTES);
  });
});
