export type SystemReviewMode = 'none' | 'daily' | 'spaced';

export interface SystemNoteType {
  readonly key: string;
  readonly name: string;
  readonly icon: null;
  readonly template: { readonly type: 'doc'; readonly content: readonly unknown[] };
  readonly fieldSchema: readonly Record<string, unknown>[];
  readonly defaultReviewMode: SystemReviewMode;
  readonly isSystem: true;
  readonly position: string;
}

function emptyDocument() {
  return { type: 'doc' as const, content: [{ type: 'paragraph' }] };
}

function headingDocument(headings: readonly string[]) {
  return {
    type: 'doc' as const,
    content: headings.flatMap((text) => [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] },
      { type: 'paragraph' },
    ]),
  };
}

function field(def: Record<string, unknown>): Record<string, unknown> {
  return { searchWeight: 'C', ...def };
}

export const SYSTEM_NOTE_TYPES: readonly SystemNoteType[] = [
  {
    key: 'runbook',
    name: 'Runbook',
    icon: null,
    template: headingDocument(['Tujuan', 'Prasyarat', 'Langkah', 'Verifikasi', 'Rollback']),
    fieldSchema: [
      field({ key: 'system', label: 'Sistem/Layanan', type: 'text', searchWeight: 'B' }),
      field({ key: 'prerequisites', label: 'Prasyarat', type: 'longtext', searchWeight: 'B' }),
      field({ key: 'risk', label: 'Risiko', type: 'select', options: ['rendah', 'sedang', 'tinggi'] }),
      field({ key: 'rollback', label: 'Rollback', type: 'longtext', searchWeight: 'C' }),
    ],
    defaultReviewMode: 'spaced',
    isSystem: true,
    position: 'a0',
  },
  {
    key: 'business_info',
    name: 'Info Bisnis',
    icon: null,
    template: headingDocument(['Ringkasan', 'Detail', 'Dampak']),
    fieldSchema: [
      field({ key: 'parties', label: 'Pihak terkait', type: 'text', searchWeight: 'B' }),
      field({ key: 'valid_until', label: 'Berlaku sampai', type: 'date', remind: { daysBefore: 7 } }),
    ],
    defaultReviewMode: 'spaced',
    isSystem: true,
    position: 'a1',
  },
  {
    key: 'work_log',
    name: 'Catatan Kerja',
    icon: null,
    template: headingDocument(['Konteks', 'Catatan', 'Tindak lanjut']),
    fieldSchema: [
      field({ key: 'project', label: 'Proyek', type: 'text', searchWeight: 'B' }),
      field({ key: 'date', label: 'Tanggal', type: 'date' }),
    ],
    defaultReviewMode: 'none',
    isSystem: true,
    position: 'a2',
  },
  {
    key: 'quick_note',
    name: 'Quick Note',
    icon: null,
    template: emptyDocument(),
    fieldSchema: [],
    defaultReviewMode: 'none',
    isSystem: true,
    position: 'a3',
  },
  {
    key: 'reference',
    name: 'Referensi',
    icon: null,
    template: emptyDocument(),
    fieldSchema: [
      field({ key: 'url', label: 'URL', type: 'url' }),
      field({ key: 'author', label: 'Penulis/Sumber', type: 'text', searchWeight: 'C' }),
    ],
    defaultReviewMode: 'none',
    isSystem: true,
    position: 'a4',
  },
];
