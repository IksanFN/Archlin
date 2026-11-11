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
      details: { issues: [{ path: 'password', message: 'Terlalu pendek' }, { path: 'email', message: 'Tidak valid' }] },
    });
    expect(messageForError(error)).toEqual({ kind: 'field', fields: { password: 'Terlalu pendek', email: 'Tidak valid' } });
  });

  it('keeps the first message when one field has several issues', () => {
    const error = appError({
      status: 422,
      code: 'invalid_input',
      details: { issues: [{ path: 'password', message: 'Pertama' }, { path: 'password', message: 'Kedua' }] },
    });
    expect(messageForError(error)).toEqual({ kind: 'field', fields: { password: 'Pertama' } });
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
