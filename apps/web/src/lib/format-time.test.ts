import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatRelative } from './format-time';

const NOW = new Date('2026-11-11T12:00:00Z');

describe('formatRelative', () => {
  it.each([
    [0, 'baru saja'],
    [30_000, 'baru saja'],
    [60_000, '1 menit lalu'],
    [59 * 60_000, '59 menit lalu'],
    [60 * 60_000, '1 jam lalu'],
    [23 * 60 * 60_000, '23 jam lalu'],
    [24 * 60 * 60_000, '1 hari lalu'],
    [6 * 24 * 60 * 60_000, '6 hari lalu'],
  ])('describes %i ms ago as %s', (elapsedMs, expected) => {
    expect(formatRelative(new Date(NOW.getTime() - elapsedMs), NOW)).toBe(expected);
  });

  it('never reports a future instant as a negative age', () => {
    expect(formatRelative(new Date(NOW.getTime() + 5 * 60_000), NOW)).toBe('baru saja');
  });
});

describe('formatDate', () => {
  it('writes the date in Indonesian in the viewer time zone', () => {
    expect(formatDate(new Date('2026-11-10T18:00:00Z'), 'Asia/Jakarta')).toBe('11 November 2026');
  });
});

describe('formatDateTime', () => {
  it('writes an absolute time in the viewer time zone', () => {
    const text = formatDateTime(new Date('2026-11-11T03:05:00Z'), 'Asia/Jakarta');
    expect(text).toContain('11');
    expect(text).toContain('10.05');
  });

  it('shifts with the time zone', () => {
    const instant = new Date('2026-11-11T03:05:00Z');
    expect(formatDateTime(instant, 'Asia/Jakarta')).not.toBe(formatDateTime(instant, 'America/New_York'));
  });
});
