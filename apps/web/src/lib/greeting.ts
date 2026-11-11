export type Greeting = 'Selamat pagi' | 'Selamat siang' | 'Selamat sore' | 'Selamat malam';

function localHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(date);
  return Number(hour);
}

export function greetingFor(date: Date, timeZone: string): Greeting {
  const hour = localHour(date, timeZone);
  if (hour >= 4 && hour <= 10) return 'Selamat pagi';
  if (hour >= 11 && hour <= 14) return 'Selamat siang';
  if (hour >= 15 && hour <= 17) return 'Selamat sore';
  return 'Selamat malam';
}

export function formatToday(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(date);
}
