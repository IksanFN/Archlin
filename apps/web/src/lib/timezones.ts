const DEFAULT_TIMEZONE = 'Asia/Jakarta';

export function initialTimezone(browserTimeZone: string | undefined, supported: readonly string[]): string {
  return browserTimeZone !== undefined && supported.includes(browserTimeZone) ? browserTimeZone : DEFAULT_TIMEZONE;
}

// Offered values come from the same list the server validates against, so a pick can never be rejected as unknown.
export function timezoneOptions(): readonly string[] {
  const others = Intl.supportedValuesOf('timeZone')
    .filter((zone) => zone !== DEFAULT_TIMEZONE)
    .sort();
  return [DEFAULT_TIMEZONE, ...others];
}

function zoneName(timeZone: string, at: Date, locale: string, style: 'short' | 'shortOffset'): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style }).formatToParts(at);
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}

// "Asia/Jakarta (WIB, UTC+7)"; zones with no local abbreviation (the browser falls back to "GMT+3") show the offset only.
export function formatTimezoneLabel(timeZone: string, at: Date): string {
  const abbreviation = zoneName(timeZone, at, 'id-ID', 'short');
  const offset = zoneName(timeZone, at, 'en-US', 'shortOffset').replace('GMT', 'UTC');
  const normalizedOffset = offset === 'UTC' ? 'UTC+0' : offset;
  if (abbreviation === '' || abbreviation.startsWith('GMT') || abbreviation.startsWith('UTC')) {
    return `${timeZone} (${normalizedOffset})`;
  }
  return `${timeZone} (${abbreviation}, ${normalizedOffset})`;
}
