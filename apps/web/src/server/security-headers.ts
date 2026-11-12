export interface SecurityHeaderOptions {
  nonce: string;
  https: boolean;
  // 'vite-dev' exists only for `vite dev`, whose React Refresh preamble and HMR socket carry no nonce.
  mode: 'strict' | 'vite-dev';
}

export function buildSecurityHeaders({ nonce, https, mode }: SecurityHeaderOptions): Record<string, string> {
  const scriptSrc = mode === 'strict' ? `'self' 'nonce-${nonce}'` : "'self' 'unsafe-inline'";
  const connectSrc = mode === 'strict' ? "'self'" : "'self' ws://localhost:*";
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  return {
    'Content-Security-Policy': csp,
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...(https ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
}
