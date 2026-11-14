import { describe, expect, it } from 'vitest';
import { announcementFor } from './save-status';

const labels = {
  saving: 'Menyimpan…',
  saved: 'Tersimpan',
  error: 'Gagal menyimpan',
  offline: 'Offline',
  conflict: 'Konflik',
  invalid: 'Tidak valid',
  signedOut: 'Sesi berakhir',
  tooLarge: 'Terlalu besar',
};

describe('announcementFor', () => {
  it('announces only states that need attention', () => {
    expect(announcementFor('idle', labels)).toBe('');
    expect(announcementFor('saving', labels)).toBe('');
    expect(announcementFor('saved', labels)).toBe('');
    expect(announcementFor('error', labels)).toBe(labels.error);
    expect(announcementFor('offline', labels)).toBe(labels.offline);
    expect(announcementFor('conflict', labels)).toBe(labels.conflict);
    expect(announcementFor('invalid', labels)).toBe(labels.invalid);
    expect(announcementFor('signedOut', labels)).toBe(labels.signedOut);
    expect(announcementFor('tooLarge', labels)).toBe(labels.tooLarge);
  });
});
