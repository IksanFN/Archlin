import { describe, expect, it } from 'vitest';
import { buildSecurityHeaders } from './security-headers';

describe('buildSecurityHeaders', () => {
  it('builds the baseline csp with the request nonce', () => {
    expect(buildSecurityHeaders({ nonce: 'abc', https: false, mode: 'strict' })['Content-Security-Policy']).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
  });

  it('sets the fixed hardening headers', () => {
    expect(buildSecurityHeaders({ nonce: 'abc', https: false, mode: 'strict' })).toMatchObject({
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
  });

  it('sends hsts only over https', () => {
    expect(buildSecurityHeaders({ nonce: 'n', https: false, mode: 'strict' })).not.toHaveProperty('Strict-Transport-Security');
    expect(buildSecurityHeaders({ nonce: 'n', https: true, mode: 'strict' })['Strict-Transport-Security']).toBe('max-age=31536000');
  });

  it('never allows unsafe-eval in any mode', () => {
    for (const mode of ['strict', 'vite-dev'] as const) {
      expect(buildSecurityHeaders({ nonce: 'n', https: true, mode })['Content-Security-Policy']).not.toContain('unsafe-eval');
    }
  });

  it('strict mode never allows unsafe-inline scripts', () => {
    const csp = buildSecurityHeaders({ nonce: 'n', https: false, mode: 'strict' })['Content-Security-Policy'] ?? '';
    const scriptSrc = csp.split('; ').find((directive) => directive.startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(csp).not.toContain('ws:');
  });

  it('vite-dev mode relaxes only script and connect sources, without a nonce', () => {
    const csp = buildSecurityHeaders({ nonce: 'n', https: false, mode: 'vite-dev' })['Content-Security-Policy'] ?? '';
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' ws://localhost:*");
    expect(csp).not.toContain('nonce-');
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
