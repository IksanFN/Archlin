import type { FieldDefinition } from '@archlin/modules-knowledge/shared';
import { describe, expect, it } from 'vitest';
import { keyForNewField, newFieldRow, relabelRow, rowProblems, rowsFromSchema, rowsToSchema, saveRejection, serverProblems } from './field-rows';

const RUNBOOK: FieldDefinition[] = [
  { key: 'system', label: 'Sistem/Layanan', type: 'text', searchWeight: 'B' },
  { key: 'prerequisites', label: 'Prasyarat', type: 'longtext', searchWeight: 'B' },
  { key: 'risk', label: 'Risiko', type: 'select', options: ['rendah', 'sedang', 'tinggi'], searchWeight: 'C' },
  { key: 'valid_until', label: 'Berlaku sampai', type: 'date', remind: { daysBefore: 7 }, required: true, searchWeight: 'C' },
];

describe('field rows', () => {
  it('round-trips the runbook schema', () => {
    const rows = rowsFromSchema(RUNBOOK);
    expect(rows.every((row) => row.persisted)).toBe(true);
    expect(rowsToSchema(rows)).toEqual(RUNBOOK);
  });

  it('drops options from non-select fields and remind from non-date fields', () => {
    const [text] = rowsFromSchema([{ key: 'system', label: 'Sistem', type: 'text', searchWeight: 'C' }]);
    if (text === undefined) throw new Error('expected a row');
    const [schema] = rowsToSchema([{ ...text, options: ['a'], remindDays: 3 }]);
    expect(schema).toEqual({ key: 'system', label: 'Sistem', type: 'text', searchWeight: 'C' });
  });

  it('a persisted row keeps its key when the label changes', () => {
    const [row] = rowsFromSchema([{ key: 'system', label: 'Sistem', type: 'text', searchWeight: 'C' }]);
    if (row === undefined) throw new Error('expected a row');
    expect(relabelRow(row, 'Layanan inti', new Set(['system']))).toMatchObject({ key: 'system', label: 'Layanan inti' });
  });

  it('a new row derives a unique key', () => {
    expect(keyForNewField('Tanggal rapat', new Set())).toBe('tanggal_rapat');
    expect(keyForNewField('Peserta', new Set(['peserta']))).toBe('peserta_2');
    const row = newFieldRow('row-1', new Set(['peserta']));
    expect(relabelRow(row, 'Peserta', new Set(['peserta']))).toMatchObject({ key: 'peserta_2', persisted: false });
  });

  it('flags an empty label, a select without options and a reminder outside 0 to 365', () => {
    const base = newFieldRow('row-1', new Set());
    expect(rowProblems({ ...base, label: '  ' })).toEqual({ label: true });
    expect(rowProblems({ ...base, label: 'Risiko', type: 'select', options: [] })).toEqual({ options: true });
    expect(rowProblems({ ...base, label: 'Tenggat', type: 'date', remindDays: 400 })).toEqual({ remind: true });
    expect(rowProblems({ ...base, label: 'Tenggat', type: 'date', remindDays: 0 })).toEqual({});
    expect(rowProblems({ ...base, label: 'Teks', options: [], remindDays: 999 })).toEqual({});
  });

  it('maps server issues onto the row they name and ignores the rest', () => {
    const rows = rowsFromSchema(RUNBOOK);
    const mapped = serverProblems(
      [
        { path: 'fieldSchema.2.options', message: 'invalid' },
        { path: 'fieldSchema.0.type', message: 'field_type_immutable' },
        { path: 'template', message: 'invalid_document' },
        { path: 'fieldSchema.9.label', message: 'invalid' },
      ],
      rows,
    );
    expect([...mapped.entries()]).toEqual([
      ['persisted:risk', { options: true }],
      ['persisted:system', { type: true }],
    ]);
  });

  it('shows a rejected save on its rows only when an issue names one, otherwise as a failure', () => {
    const rows = rowsFromSchema(RUNBOOK);
    expect(saveRejection([{ path: 'fieldSchema.1.label', message: 'invalid' }], rows).kind).toBe('rows');
    expect(saveRejection([{ path: 'template', message: 'invalid_document' }], rows).kind).toBe('failure');
    expect(saveRejection([], rows).kind).toBe('failure');
  });
});
