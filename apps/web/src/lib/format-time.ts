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
