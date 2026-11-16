const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelative(from: Date, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - from.getTime());
  if (elapsed < MINUTE) return 'baru saja';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} menit lalu`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} jam lalu`;
  return `${Math.floor(elapsed / DAY)} hari lalu`;
}

export function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(date);
}

export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
}

const WEEK = 7 * DAY;

// Version rows read as "3 jam lalu" while recent and as a date and time once the age stops being useful to count.
export function formatVersionTime(date: Date, now: Date, timeZone: string): string {
  return now.getTime() - date.getTime() < WEEK ? formatRelative(date, now) : formatDateTime(date, timeZone);
}
