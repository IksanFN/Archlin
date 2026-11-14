import { describe, expect, it } from 'vitest';
import type { EditorLabels } from './labels';
import { filterSlashItems, slashItems } from './slash-items';

const testLabels: EditorLabels = {
  title: 'Judul',
  untitled: 'Tanpa judul',
  placeholder: 'Ketik / untuk menyisipkan blok',
  headingPlaceholder: 'Judul bagian',
  copy: 'Salin',
  copied: 'Disalin',
  copyFailed: 'Tidak bisa menyalin. Salin manual.',
  plainText: 'Teks biasa',
  calloutVariant: 'Jenis callout',
  callout: { info: 'Info', warning: 'Peringatan', danger: 'Bahaya', success: 'Sukses' },
  bold: 'Tebal',
  italic: 'Miring',
  underline: 'Garis bawah',
  strike: 'Coret',
  code: 'Kode',
  link: 'Tautan',
  linkUrl: 'Alamat tautan',
  linkInvalid: 'Pakai alamat http, https, atau mailto.',
  linkSave: 'Simpan',
  linkRemove: 'Hapus tautan',
  table: {
    addRowBelow: 'Tambah baris di bawah',
    addColumnRight: 'Tambah kolom di kanan',
    deleteRow: 'Hapus baris',
    deleteColumn: 'Hapus kolom',
    headerRow: 'Baris judul',
    deleteTable: 'Hapus tabel',
  },
  image: {
    title: 'Gambar dari URL',
    url: 'Alamat gambar',
    urlInvalid: 'Pakai alamat https.',
    alt: 'Deskripsi gambar',
    altHelper: 'Dibacakan pembaca layar. Kosongkan bila hanya hiasan.',
    insert: 'Sisipkan',
    loadFailed: 'Gambar tidak bisa dimuat dari alamat ini.',
  },
  slashEmpty: 'Tidak ada blok yang cocok',
  slash: {
    text: 'Teks',
    heading1: 'Judul 1',
    heading2: 'Judul 2',
    heading3: 'Judul 3',
    bulletList: 'Daftar',
    orderedList: 'Daftar bernomor',
    taskList: 'Daftar tugas',
    quote: 'Kutipan',
    codeBlock: 'Blok kode',
    calloutInfo: 'Callout info',
    calloutWarning: 'Callout peringatan',
    calloutDanger: 'Callout bahaya',
    calloutSuccess: 'Callout sukses',
    details: 'Toggle',
    table: 'Tabel',
    divider: 'Garis pemisah',
    image: 'Gambar dari URL',
  },
  block: {
    handle: 'Opsi blok',
    moveUp: 'Pindah ke atas',
    moveDown: 'Pindah ke bawah',
    duplicate: 'Duplikat',
    delete: 'Hapus',
  },
  find: {
    find: 'Cari',
    replace: 'Ganti dengan',
    previous: 'Sebelumnya',
    next: 'Berikutnya',
    replaceOne: 'Ganti',
    replaceAll: 'Ganti semua',
    caseSensitive: 'Beda huruf besar',
    count: (current, total) => `${current} dari ${total}`,
    close: 'Tutup pencarian',
  },
};

describe('slash items', () => {
  const items = slashItems(testLabels);

  it('filters by label prefix before keyword', () => {
    const ids = filterSlashItems(items, 'to').map((item) => item.id);
    expect(ids[0]).toBe('details');
    expect(ids).toContain('taskList');
    expect(ids.indexOf('details')).toBeLessThan(ids.indexOf('taskList'));
  });

  it('ignores case and diacritics', () => {
    expect(filterSlashItems(items, 'JUDÚL').map((item) => item.id)).toEqual(['heading1', 'heading2', 'heading3']);
    expect(filterSlashItems(items, 'tábel').map((item) => item.id)).toEqual(['table']);
  });

  it('an empty query lists every item', () => {
    expect(filterSlashItems(items, '').map((item) => item.id)).toEqual(items.map((item) => item.id));
    expect(items.map((item) => ({ id: item.id, label: item.label }))).toEqual([
      { id: 'text', label: 'Teks' },
      { id: 'heading1', label: 'Judul 1' },
      { id: 'heading2', label: 'Judul 2' },
      { id: 'heading3', label: 'Judul 3' },
      { id: 'bulletList', label: 'Daftar' },
      { id: 'orderedList', label: 'Daftar bernomor' },
      { id: 'taskList', label: 'Daftar tugas' },
      { id: 'quote', label: 'Kutipan' },
      { id: 'codeBlock', label: 'Blok kode' },
      { id: 'calloutInfo', label: 'Callout info' },
      { id: 'calloutWarning', label: 'Callout peringatan' },
      { id: 'calloutDanger', label: 'Callout bahaya' },
      { id: 'calloutSuccess', label: 'Callout sukses' },
      { id: 'details', label: 'Toggle' },
      { id: 'table', label: 'Tabel' },
      { id: 'divider', label: 'Garis pemisah' },
      { id: 'image', label: 'Gambar dari URL' },
    ]);
  });

  it('finds the task list through the english keyword todo', () => {
    expect(filterSlashItems(items, 'todo').map((item) => item.id)).toEqual(['taskList']);
  });
});
