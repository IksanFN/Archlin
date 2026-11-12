import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  fieldDefinitionSchema,
  fieldSchemaSchema,
  legacyKeys,
  missingRequired,
  validateProperties,
  type FieldDefinition,
  type FieldType,
} from './field-schema';

function field(type: FieldType): FieldDefinition {
  if (type === 'select') return { key: 'f', label: 'F', type, options: ['rendah', 'tinggi'] };
  return { key: 'f', label: 'F', type };
}

describe('field schema', () => {
  it('accepts the five system schemas', () => {
    // Copied from the server system types; shared tests cannot import that module.
    const runbook = [
      { key: 'system', label: 'Sistem/Layanan', type: 'text', searchWeight: 'B' },
      { key: 'prerequisites', label: 'Prasyarat', type: 'longtext', searchWeight: 'B' },
      { key: 'risk', label: 'Risiko', type: 'select', options: ['rendah', 'sedang', 'tinggi'], searchWeight: 'C' },
      { key: 'rollback', label: 'Rollback', type: 'longtext', searchWeight: 'C' },
    ];
    const businessInfo = [
      { key: 'parties', label: 'Pihak terkait', type: 'text', searchWeight: 'B' },
      { key: 'valid_until', label: 'Berlaku sampai', type: 'date', remind: { daysBefore: 7 }, searchWeight: 'C' },
    ];
    const workLog = [
      { key: 'project', label: 'Proyek', type: 'text', searchWeight: 'B' },
      { key: 'date', label: 'Tanggal', type: 'date', searchWeight: 'C' },
    ];
    const quickNote: unknown[] = [];
    const reference = [
      { key: 'url', label: 'URL', type: 'url', searchWeight: 'C' },
      { key: 'author', label: 'Penulis/Sumber', type: 'text', searchWeight: 'C' },
    ];

    for (const schema of [runbook, businessInfo, workLog, quickNote, reference]) {
      expect(fieldSchemaSchema.safeParse(schema).success).toBe(true);
    }
  });

  it('rejects duplicate keys and keys outside the pattern', () => {
    const text = { label: 'Field', type: 'text' as const };
    const duplicate = fieldSchemaSchema.safeParse([
      { ...text, key: 'risk' },
      { ...text, key: 'risk' },
    ]);
    expect(duplicate.success).toBe(false);
    if (duplicate.success) throw new Error('expected duplicate keys to fail');
    expect(duplicate.error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: [1, 'key'], message: 'duplicate_key' })]),
    );

    for (const key of ['__proto__', 'Risk', 'a-b', '1x']) {
      expect(fieldDefinitionSchema.safeParse({ ...text, key }).success).toBe(false);
    }
  });

  it('select requires one to thirty unique options and other types reject options', () => {
    const select = (options: unknown) => ({ key: 'risk', label: 'Risiko', type: 'select' as const, options });
    expect(fieldDefinitionSchema.safeParse(select(['rendah'])).success).toBe(true);
    expect(fieldDefinitionSchema.safeParse(select(Array.from({ length: 30 }, (_, i) => `o${i}`))).success).toBe(true);
    expect(fieldDefinitionSchema.safeParse({ key: 'risk', label: 'Risiko', type: 'select' }).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse(select([])).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse(select(Array.from({ length: 31 }, (_, i) => `o${i}`))).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse(select(['a', 'a'])).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse(select(['a', ' a '])).success).toBe(false);

    for (const type of FIELD_TYPES.filter((value) => value !== 'select')) {
      expect(fieldDefinitionSchema.safeParse({ key: 'f', label: 'F', type, options: ['x'] }).success).toBe(false);
    }
  });

  it('remind is allowed on date fields only', () => {
    expect(fieldDefinitionSchema.safeParse({ key: 'due', label: 'Due', type: 'date', remind: { daysBefore: 0 } }).success).toBe(
      true,
    );
    expect(
      fieldDefinitionSchema.safeParse({ key: 'due', label: 'Due', type: 'date', remind: { daysBefore: 365 } }).success,
    ).toBe(true);
    expect(fieldDefinitionSchema.safeParse({ key: 'due', label: 'Due', type: 'date', remind: { daysBefore: -1 } }).success).toBe(
      false,
    );
    expect(
      fieldDefinitionSchema.safeParse({ key: 'due', label: 'Due', type: 'date', remind: { daysBefore: 366 } }).success,
    ).toBe(false);
    expect(
      fieldDefinitionSchema.safeParse({ key: 'due', label: 'Due', type: 'date', remind: { daysBefore: 1.5 } }).success,
    ).toBe(false);

    for (const type of FIELD_TYPES.filter((value) => value !== 'date')) {
      const extra = type === 'select' ? { options: ['a'] } : {};
      expect(
        fieldDefinitionSchema.safeParse({ key: 'f', label: 'F', type, remind: { daysBefore: 7 }, ...extra }).success,
      ).toBe(false);
    }
  });

  it.each<[FieldType, unknown]>([
    ['text', 42],
    ['longtext', 'x'.repeat(10_001)],
    ['date', '2026-02-30'],
    ['date', '30/11/2026'],
    ['select', 'kritis'],
    ['url', 'javascript:alert(1)'],
    ['url', 'ftp://x.id'],
    ['number', 'satu'],
    ['number', Infinity],
  ])('%s rejects %s', (type, value) => {
    expect(validateProperties([field(type)], { f: value }, {})).toEqual([
      { path: 'properties.f', message: 'invalid_property' },
    ]);
  });

  it('accepts null, missing and empty values for required fields', () => {
    const required: FieldDefinition = { key: 'f', label: 'F', type: 'text', required: true };
    expect(validateProperties([required], { f: null }, {})).toEqual([]);
    expect(validateProperties([required], { f: '' }, {})).toEqual([]);
    expect(validateProperties([required], { f: '   ' }, {})).toEqual([]);
    expect(validateProperties([required], {}, {})).toEqual([]);
  });

  it('an unchanged legacy value passes even when it no longer matches the field', () => {
    const risk: FieldDefinition = { key: 'risk', label: 'Risiko', type: 'select', options: ['rendah', 'tinggi'] };
    expect(validateProperties([risk], { risk: 'sedang' }, { risk: 'sedang' })).toEqual([]);
    expect(validateProperties([risk], { risk: 'kritis' }, { risk: 'sedang' })).toEqual([
      { path: 'properties.risk', message: 'invalid_property' },
    ]);
  });

  it('rejects unknown keys that were not stored before and keeps those that were', () => {
    const name: FieldDefinition = { key: 'name', label: 'Nama', type: 'text' };
    expect(validateProperties([name], { extra: 'x' }, {})).toEqual([
      { path: 'properties.extra', message: 'unknown_property' },
    ]);
    expect(validateProperties([name], { extra: 'x' }, { extra: 'x' })).toEqual([]);
    expect(validateProperties([name], { extra: 'y' }, { extra: 'x' })).toEqual([
      { path: 'properties.extra', message: 'unknown_property' },
    ]);
  });

  it('missingRequired lists required fields with empty values', () => {
    const fields: FieldDefinition[] = [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'body', label: 'Body', type: 'longtext', required: true },
      { key: 'note', label: 'Note', type: 'text' },
    ];
    expect(missingRequired(fields, { title: 'Ada', body: 'Ada' })).toEqual([]);
    expect(missingRequired(fields, { title: 'Ada', body: '' })).toEqual(['body']);
    expect(missingRequired(fields, { title: '  ', body: null })).toEqual(['title', 'body']);
    expect(missingRequired(fields, {})).toEqual(['title', 'body']);
  });

  it('legacyKeys lists stored values that fail their field', () => {
    const fields: FieldDefinition[] = [
      { key: 'risk', label: 'Risiko', type: 'select', options: ['rendah', 'tinggi'] },
      { key: 'when', label: 'When', type: 'date' },
    ];
    expect(legacyKeys(fields, { risk: 'sedang', when: '2026-01-01' })).toEqual(['risk']);
    expect(legacyKeys(fields, { risk: 'rendah', when: '2026-02-30' })).toEqual(['when']);
    expect(legacyKeys(fields, { risk: 'rendah', when: '2026-01-01' })).toEqual([]);
    expect(legacyKeys(fields, { risk: '', when: null, extra: 'kept' })).toEqual([]);
  });
});
