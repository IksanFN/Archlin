import { describe, expect, it } from 'vitest';
import { formatToday, greetingFor } from './greeting';

describe('greetingFor', () => {
  it.each([
    ['2026-11-10T21:00:00Z', 'Selamat pagi'], // 04:00 WIB
    ['2026-11-11T03:59:00Z', 'Selamat pagi'], // 10:59
    ['2026-11-11T04:00:00Z', 'Selamat siang'], // 11:00
    ['2026-11-11T07:59:00Z', 'Selamat siang'], // 14:59
    ['2026-11-11T08:00:00Z', 'Selamat sore'], // 15:00
    ['2026-11-11T10:59:00Z', 'Selamat sore'], // 17:59
    ['2026-11-11T11:00:00Z', 'Selamat malam'], // 18:00
    ['2026-11-10T20:59:00Z', 'Selamat malam'], // 03:59
  ])('greets %s in Asia/Jakarta as %s', (iso, expected) => {
    expect(greetingFor(new Date(iso), 'Asia/Jakarta')).toBe(expected);
  });

  it('uses the viewer time zone, not the server one', () => {
    // 04:00 UTC is 11:00 in Jakarta but 05:00 in Berlin, so the two zones fall on different sides of the pagi/siang line.
    const instant = new Date('2026-11-11T04:00:00Z');
    expect(greetingFor(instant, 'Asia/Jakarta')).toBe('Selamat siang');
    expect(greetingFor(instant, 'Europe/Berlin')).toBe('Selamat pagi');
  });
});

describe('formatToday', () => {
  it('formats today in Indonesian for the viewer time zone', () => {
    expect(formatToday(new Date('2026-11-10T18:00:00Z'), 'Asia/Jakarta')).toBe('Rabu, 11 November');
  });

  it('rolls the date over at local midnight, not UTC midnight', () => {
    expect(formatToday(new Date('2026-11-10T16:59:00Z'), 'Asia/Jakarta')).toBe('Selasa, 10 November');
    expect(formatToday(new Date('2026-11-10T17:00:00Z'), 'Asia/Jakarta')).toBe('Rabu, 11 November');
  });
});
