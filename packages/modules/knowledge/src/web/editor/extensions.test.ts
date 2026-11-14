import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { getDocumentSchema } from '../../shared/document-schema';
import { editorExtensions } from './extensions';
import type { EditorLabels } from './labels';

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
};

describe('editor extensions', () => {
  it('the editor schema equals the server schema', () => {
    const web = getSchema(editorExtensions(testLabels));
    const server = getDocumentSchema();
    const describe = (s: Schema) => ({
      nodes: Object.fromEntries(
        Object.entries(s.nodes).map(([n, t]) => [n, { attrs: Object.keys(t.spec.attrs ?? {}).sort(), content: t.spec.content ?? '' }]),
      ),
      marks: Object.keys(s.marks).sort(),
    });
    expect(describe(web)).toEqual(describe(server));
  });
});
