import type { SecurityEventName } from '@archlin/platform/contracts';

// A Record over the closed event list: adding an event name without a label is a compile error.
const LABELS: Record<SecurityEventName, string> = {
  'login.success': 'Berhasil masuk',
  'login.failed': 'Gagal masuk',
  'login.locked': 'Login dikunci sementara',
  'session.revoked': 'Sesi dicabut',
  'password.changed': 'Password diganti',
  'totp.enabled': 'Verifikasi dua langkah diaktifkan',
  'totp.disabled': 'Verifikasi dua langkah dinonaktifkan',
  'recovery_code.used': 'Kode cadangan dipakai',
  'recovery_codes.regenerated': 'Kode cadangan dibuat ulang',
  'api_token.created': 'Token API dibuat',
  'api_token.revoked': 'Token API dicabut',
};

export function securityEventLabel(event: SecurityEventName): string {
  return LABELS[event];
}
