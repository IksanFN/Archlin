import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { getDocumentSchema } from '../../shared/document-schema';
import { createLinkTargetStore } from '../links/link-targets';
import type { PageEditorLinks } from '../links/page-editor-links';
import { editorExtensions } from './extensions';
import type { EditorLabels } from './labels';

const testLabels: EditorLabels = {
  links: {
    searching: 'Mencari…',
    empty: 'Tidak ada halaman yang cocok.',
    loadFailed: 'Saran halaman gagal dimuat.',
    createItem: (query) => `Tautkan “${query}” sebagai halaman baru`,
    found: (count) => `${count} halaman ditemukan`,
    unresolvedBody: (title) => `Halaman “${title}” belum ada.`,
    createPage: 'Buat halaman',
    ambiguousBody: (title) => `Ada beberapa halaman berjudul “${title}”. Pilih yang dimaksud.`,
    inTrash: 'Ada di Trash',
    pickerLabel: 'Pilih halaman untuk ditautkan',
  },
  attachments: {
    title: 'Lampiran',
    upload: 'Unggah file',
    open: 'Buka',
    download: 'Unduh',
    status: { pending: 'Menunggu ekstraksi teks', done: 'Teks terekstrak', no_text: 'Teks tidak ditemukan', unsupported: 'Tidak diekstrak', failed: 'Ekstraksi gagal' },
    retry: 'Coba lagi',
    unusedTitle: 'Tidak dipakai',
    unusedBody: 'Tidak ada di isi halaman maupun di versi tersimpan.',
    moveUnused: 'Pindahkan ke Trash',
    movedUnused: (count) => `${count} lampiran dipindahkan ke Trash.`,
    emptyTitle: 'Belum ada lampiran',
    emptyBody: 'Tempel atau seret file ke isi halaman.',
    uploading: (name) => `Mengunggah ${name}…`,
    uploaded: (name) => `${name} terunggah.`,
    uploadFailed: (name) => `${name} gagal diunggah.`,
    cancel: 'Batal',
    discard: 'Buang',
    dropHere: 'Lepaskan untuk mengunggah',
    missing: 'Lampiran tidak tersedia',
    inTrash: 'Lampiran ada di Trash',
    tooLarge: (name) => `${name} lebih dari 50 MB dan tidak diunggah.`,
    fileEmpty: 'File kosong tidak bisa diunggah.',
    copyFailed: 'Lampiran dari halaman lain tetap merujuk halaman asalnya.',
    loadFailed: 'Daftar lampiran gagal dimuat.',
    closePanel: 'Tutup panel lampiran',
    uploadProgress: (name) => `Progres unggah ${name}`,
  },
  title: 'Judul',
  body: 'Isi halaman',
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
    upload: 'Unggah dari perangkat',
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
    attachment: 'Lampiran',
  },
  block: {
    handle: 'Opsi blok',
    moveUp: 'Pindah ke atas',
    moveUpShortcut: 'Alt+Shift+↑',
    moveDown: 'Pindah ke bawah',
    moveDownShortcut: 'Alt+Shift+↓',
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

const links: PageEditorLinks = {
  store: createLinkTargetStore([]),
  entityId: 'e',
  spaceId: 's',
  spaceSlug: 'kerja',
  client: { suggestPages: () => Promise.resolve([]) },
  navigate: () => undefined,
  createLinkedPage: () => Promise.resolve({ entityId: 'n', spaceSlug: 'kerja' }),
};

const describeSchema = (schema: Schema) => ({
  nodes: Object.fromEntries(
    Object.entries(schema.nodes).map(([name, type]) => [name, { attrs: Object.keys(type.spec.attrs ?? {}).sort(), content: type.spec.content ?? '' }]),
  ),
  marks: Object.keys(schema.marks).sort(),
});

describe('editor extensions', () => {
  it.each([
    ['for a page', { links }],
    ['without links', {}],
  ])('the editor schema equals the server schema %s', (_name, options) => {
    const web = getSchema(editorExtensions(testLabels, options));
    expect(describeSchema(web)).toEqual(describeSchema(getDocumentSchema()));
    expect(Object.keys(web.nodes)).toEqual(expect.arrayContaining(['wikiLink', 'mention', 'attachment', 'image']));
  });
});
