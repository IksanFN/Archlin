export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

// supportedValuesOf omits the bare 'UTC' alias that browsers report.
const SUPPORTED_TIMEZONES: ReadonlySet<string> = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

export function isSupportedTimezone(value: string): boolean {
  return SUPPORTED_TIMEZONES.has(value);
}
