import { SECURITY_EVENT_NAMES } from '@archlin/platform/contracts';
import { describe, expect, it } from 'vitest';
import { securityEventLabel } from './security-event-labels';

describe('securityEventLabel', () => {
  it('labels every security event name with readable Indonesian', () => {
    expect(SECURITY_EVENT_NAMES).toHaveLength(11);
    for (const name of SECURITY_EVENT_NAMES) {
      const label = securityEventLabel(name);
      expect(label).not.toBe('');
      expect(label).not.toBe(name);
      expect(label).not.toMatch(/[._]/);
    }
  });

  it('uses the agreed wording for the common events', () => {
    expect(securityEventLabel('login.success')).toBe('Berhasil masuk');
    expect(securityEventLabel('login.locked')).toBe('Login dikunci sementara');
    expect(securityEventLabel('totp.enabled')).toBe('Verifikasi dua langkah diaktifkan');
    expect(securityEventLabel('recovery_codes.regenerated')).toBe('Kode cadangan dibuat ulang');
  });
});
