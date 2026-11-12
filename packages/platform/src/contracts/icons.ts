import { z } from 'zod';

const graphemeSegmenter = new Intl.Segmenter('id', { granularity: 'grapheme' });

export function isSingleEmoji(value: string): boolean {
  if (value.length === 0 || value.length > 16) return false;
  const graphemes = [...graphemeSegmenter.segment(value)];
  if (graphemes.length !== 1) return false;
  const grapheme = graphemes[0]?.segment;
  if (grapheme === undefined) return false;
  return /^\p{Extended_Pictographic}/u.test(grapheme) || /^\p{Regional_Indicator}{2}$/u.test(grapheme);
}

export const emojiIconSchema = z.string().refine(isSingleEmoji, 'invalid_icon').nullable();
