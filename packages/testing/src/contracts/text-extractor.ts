import type { TextExtractor } from '@archlin/platform/contracts';
import { describe, expect, it } from 'vitest';

export interface TextExtractorFixtures {
  mime: string;
  valid: Uint8Array;
  expectedText: string;
  corrupt: Uint8Array;
}

// One suite for every TextExtractor: what a module must promise no matter which file type it reads.
export function textExtractorContract(name: string, extractor: TextExtractor, fixtures: TextExtractorFixtures): void {
  describe(`TextExtractor contract: ${name}`, () => {
    it('supports its own mime type and not an unrelated one', () => {
      expect(extractor.supports(fixtures.mime)).toBe(true);
      expect(extractor.supports('application/x-unrelated')).toBe(false);
    });

    it('a valid file yields its text', async () => {
      expect(await extractor.extract(fixtures.valid, { maxChars: 1_000_000 })).toEqual({ status: 'done', text: fixtures.expectedText });
    });

    it('the text never exceeds maxChars', async () => {
      const result = await extractor.extract(fixtures.valid, { maxChars: 3 });
      expect(result.status).toBe('done');
      if (result.status === 'done') expect(result.text.length).toBeLessThanOrEqual(3);
    });

    it('a corrupt file fails with a code instead of throwing', async () => {
      const result = await extractor.extract(fixtures.corrupt, { maxChars: 1_000_000 });
      expect(result).toMatchObject({ status: 'failed' });
    });
  });
}
