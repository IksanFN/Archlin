import { SNAPSHOT_REASONS } from '@archlin/modules-knowledge/shared';
import type { FieldDefinition, PageView, VersionDetail } from '@archlin/modules-knowledge/shared';
import { describe, expect, it } from 'vitest';
import type { PageDraftState } from '../autosave/autosave-machine';
import { fieldLabel, reasonLabel, snapshotFromDetail, snapshotFromDraft } from './history-model';
import type { HistoryLabels } from './labels';

const labels = {
  reasons: {
    idle: 'Otomatis · jeda > 10 menit',
    leave: 'Otomatis · meninggalkan halaman',
    manual: 'Manual',
    conflict: 'Konflik',
    pre_restore: 'Sebelum pemulihan',
    import: 'Import Docmost',
  },
  fields: { title: 'Judul', noteType: 'Tipe catatan', summary: 'Ringkasan', whenToUse: 'Kapan dipakai', source: 'Sumber', aliases: 'Alias' },
} as unknown as HistoryLabels;

const paragraph = (...parts: string[]) => ({ type: 'paragraph', content: parts.map((text) => ({ type: 'text', text })) });
const docOf = (...lines: string[]) => ({ type: 'doc', content: lines.map((line) => paragraph(line)) });

const page = {
  title: 'Rollback',
  noteType: { id: 't', key: 'runbook', name: 'Runbook', icon: null, fieldSchema: [], schemaVersion: 1 },
  context: { summary: null, whenToUse: null, source: null, aliases: [] },
  properties: {},
} as unknown as PageView;

const draft: PageDraftState = {
  title: 'Rollback',
  content: docOf('Langkah'),
  context: { summary: 'ringkas', whenToUse: null, source: null, aliases: ['a'] },
  properties: { risk: 'rendah' },
};

describe('history model', () => {
  it('reasonLabel maps every snapshot reason to its copy', () => {
    expect(SNAPSHOT_REASONS.map((reason) => reasonLabel(reason, labels))).toEqual([
      'Otomatis · jeda > 10 menit',
      'Otomatis · meninggalkan halaman',
      'Manual',
      'Sebelum pemulihan',
      'Konflik',
      'Import Docmost',
    ]);
    expect(SNAPSHOT_REASONS).toEqual(['idle', 'leave', 'manual', 'pre_restore', 'conflict', 'import']);
  });

  it('fieldLabel uses the field label of the current type and falls back to the key', () => {
    const schema: readonly FieldDefinition[] = [{ key: 'risk', label: 'Risiko', type: 'select', options: ['rendah'] }];
    expect(fieldLabel('property:risk', schema, labels)).toBe('Risiko');
    expect(fieldLabel('property:pihak', schema, labels)).toBe('pihak');
    expect(fieldLabel('whenToUse', schema, labels)).toBe('Kapan dipakai');
  });

  it('snapshotFromDraft derives the text of the unsaved draft document', () => {
    expect(snapshotFromDraft(page, { ...draft, content: docOf('Langkah', 'Verifikasi') }).contentText).toBe('Langkah\nVerifikasi');
  });

  it('snapshotFromDraft reads links the way the server does', () => {
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lihat ' }, { type: 'wikiLink', attrs: { entityId: null, title: 'Deploy' } }, { type: 'mention', attrs: { entityId: 'x', title: 'Rudi' } }] }] };
    expect(snapshotFromDraft(page, { ...draft, content }).contentText).toBe('Lihat Deploy@Rudi');
  });

  it('snapshotFromDraft carries the draft fields and the type name of the page', () => {
    const snapshot = snapshotFromDraft(page, draft);
    expect(snapshot).toMatchObject({ title: 'Rollback', noteTypeName: 'Runbook', properties: { risk: 'rendah' }, context: draft.context });
  });

  it('snapshotFromDetail uses the server text and the version type name', () => {
    const detail = {
      title: 'Lama',
      contentText: 'teks',
      context: draft.context,
      properties: { risk: 'tinggi' },
      noteType: { id: 't', name: null },
    } as unknown as VersionDetail;
    expect(snapshotFromDetail(detail)).toEqual({ title: 'Lama', contentText: 'teks', context: draft.context, properties: { risk: 'tinggi' }, noteTypeName: null });
  });
});
