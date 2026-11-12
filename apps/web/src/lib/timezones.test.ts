import { describe, expect, it } from 'vitest';
import { formatTimezoneLabel, initialTimezone, timezoneOptions } from './timezones';

describe('initialTimezone', () => {
  it('falls back to Asia/Jakarta for an unknown or missing browser time zone', () => {
    expect(initialTimezone('Mars/Olympus', ['Asia/Jakarta', 'Europe/Berlin'])).toBe('Asia/Jakarta');
    expect(initialTimezone(undefined, ['Asia/Jakarta'])).toBe('Asia/Jakarta');
    expect(initialTimezone('Europe/Berlin', ['Asia/Jakarta', 'Europe/Berlin'])).toBe('Europe/Berlin');
  });
});

describe('timezoneOptions', () => {
  it('lists Asia/Jakarta first and the rest in order without repeating it', () => {
    const options = timezoneOptions();
    expect(options[0]).toBe('Asia/Jakarta');
    expect(options.filter((zone) => zone === 'Asia/Jakarta')).toHaveLength(1);
    const rest = options.slice(1);
    expect(rest).toEqual([...rest].sort());
  });

  it('only offers zones the server accepts', () => {
    const supported = new Set(Intl.supportedValuesOf('timeZone'));
    expect(timezoneOptions().every((zone) => supported.has(zone))).toBe(true);
  });
});

describe('formatTimezoneLabel', () => {
  it('labels Asia/Jakarta like the mockup', () => {
    expect(formatTimezoneLabel('Asia/Jakarta', new Date('2026-11-11T00:00:00Z'))).toBe('Asia/Jakarta (WIB, UTC+7)');
  });

  it('omits the abbreviation when it only repeats the offset', () => {
    expect(formatTimezoneLabel('Etc/GMT-3', new Date('2026-11-11T00:00:00Z'))).toBe('Etc/GMT-3 (UTC+3)');
  });

  it('follows daylight saving at the given instant', () => {
    expect(formatTimezoneLabel('Europe/Berlin', new Date('2026-07-01T00:00:00Z'))).toContain('UTC+2');
    expect(formatTimezoneLabel('Europe/Berlin', new Date('2026-12-01T00:00:00Z'))).toContain('UTC+1');
  });
});
