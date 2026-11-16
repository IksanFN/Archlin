import { KnowledgeClientError } from '@archlin/modules-knowledge/web';
import { describe, expect, it } from 'vitest';
import { AppError } from '../server/errors';
import { messageForError } from './client-errors';

const appError = (init: Partial<ConstructorParameters<typeof AppError>[0]> & { status: number; code: string }) =>
  new AppError({ message: 'x', ...init });

describe('messageForError', () => {
  it('sends a missing session back to login', () => {
    expect(messageForError(appError({ status: 401, code: 'unauthenticated' }))).toEqual({ kind: 'redirect_login' });
  });

  it('keeps a wrong code on the page instead of treating it as a lost session', () => {
    expect(messageForError(appError({ status: 401, code: 'invalid_code', message: 'Kode tidak valid' }))).toEqual({
      kind: 'toast',
      text: 'Kode tidak valid',
    });
  });

  it('maps a 429 app error to a minutes message', () => {
    const error = appError({ status: 429, code: 'too_many_attempts', details: { retryAfterSeconds: 900 } });
    expect(messageForError(error)).toEqual({ kind: 'toast', text: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
  });

  it('rounds a partial minute up so the user never retries too early', () => {
    const error = appError({ status: 429, code: 'too_many_attempts', details: { retryAfterSeconds: 61 } });
    expect(messageForError(error)).toEqual({ kind: 'toast', text: 'Terlalu banyak percobaan. Coba lagi dalam 2 menit.' });
  });

  it('maps a 422 app error to field messages', () => {
    const error = appError({
      status: 422,
      code: 'invalid_input',
      details: { issues: [{ path: 'password', message: 'password_too_short' }, { path: 'email', message: 'Invalid email address' }] },
    });
    expect(messageForError(error)).toEqual({
      kind: 'field',
      fields: { password: 'Password minimal 12 karakter.', email: 'Isian ini tidak valid.' },
    });
  });

  it('keeps the first message when one field has several issues', () => {
    const error = appError({
      status: 422,
      code: 'invalid_input',
      details: { issues: [{ path: 'password', message: 'password_too_short' }, { path: 'password', message: 'password_too_long' }] },
    });
    expect(messageForError(error)).toEqual({ kind: 'field', fields: { password: 'Password minimal 12 karakter.' } });
  });

  it('maps an internal error to a message with the request id', () => {
    const error = appError({ status: 500, code: 'internal', requestId: 'req-123' });
    expect(messageForError(error)).toEqual({ kind: 'toast', text: 'Terjadi kesalahan (ID: req-123)' });
  });

  it('omits the id when the server sent none', () => {
    expect(messageForError(appError({ status: 500, code: 'internal' }))).toEqual({ kind: 'toast', text: 'Terjadi kesalahan.' });
  });

  it('reports a failure that never reached the server as a connection problem', () => {
    expect(messageForError(new TypeError('Failed to fetch'))).toEqual({
      kind: 'toast',
      text: 'Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.',
    });
  });
});

const KNOWLEDGE_COPY: Record<string, string> = {
  version_not_found: 'Versi ini sudah tidak ada. Muat ulang riwayat.',
  upload_conflict: 'Unggahan bentrok dengan file lain. Unggah ulang file ini.',
  file_too_large: 'File lebih dari 50 MB.',
  file_empty: 'File kosong tidak bisa diunggah.',
  invalid_upload: 'Unggahan tidak lengkap. Coba lagi.',
  storage_unavailable: 'Penyimpanan file di server penuh atau tidak bisa ditulis.',
  attachment_not_found: 'Lampiran tidak ditemukan.',
  blob_missing: 'File lampiran hilang dari server.',
  parent_in_trash: 'Halaman induknya ada di Trash. Pulihkan halamannya dulu.',
  link_title_too_long: 'Judul link terlalu panjang.',
  network: 'Tidak bisa menghubungi server. Coba lagi.',
};

describe('messageForError for knowledge codes', () => {
  it.each(Object.entries(KNOWLEDGE_COPY))('maps %s to its copy for a client error and a server error', (code, text) => {
    expect(messageForError(new KnowledgeClientError({ code, message: code, status: 400 }))).toEqual({ kind: 'toast', text });
    expect(messageForError(appError({ status: 400, code }))).toEqual({ kind: 'toast', text });
  });

  it('keeps the code copy for a 5xx and a 422 instead of the generic internal or field message', () => {
    expect(messageForError(appError({ status: 503, code: 'storage_unavailable' }))).toEqual({
      kind: 'toast',
      text: KNOWLEDGE_COPY.storage_unavailable,
    });
    expect(messageForError(appError({ status: 422, code: 'file_empty' }))).toEqual({ kind: 'toast', text: KNOWLEDGE_COPY.file_empty });
  });

  it('never writes an em dash in the copy', () => {
    for (const text of Object.values(KNOWLEDGE_COPY)) expect(text).not.toMatch(/—/);
  });

  it('keeps a lost session redirecting to login for a client error too', () => {
    expect(messageForError(new KnowledgeClientError({ code: 'unauthenticated', message: 'x', status: 401 }))).toEqual({ kind: 'redirect_login' });
  });
});
