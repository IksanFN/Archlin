const UNKNOWN = 'Perangkat tidak dikenal';

// Order matters: Edge and the iOS wrappers also say "Chrome" or "Safari", and iPhones also say "Mac OS X".
function browserOf(userAgent: string): string | null {
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return null;
}

function systemOf(userAgent: string): string | null {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'macOS';
  if (/Linux|X11/.test(userAgent)) return 'Linux';
  return null;
}

// Only what helps the owner recognise a device; the raw string is never shown or stored client-side.
export function describeUserAgent(userAgent: string | null): string {
  if (userAgent === null) return UNKNOWN;
  const browser = browserOf(userAgent);
  const system = systemOf(userAgent);
  return browser === null || system === null ? UNKNOWN : `${browser} di ${system}`;
}
