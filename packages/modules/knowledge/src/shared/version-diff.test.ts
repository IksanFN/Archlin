import { describe, expect, it } from 'vitest';
import { diffVersions, formatPropertyValue } from './version-diff';
import type { VersionSnapshot } from './version-diff';

const base: VersionSnapshot = {
  title: 'Rollback',
  contentText: 'a\nb\nc',
  context: { summary: null, whenToUse: null, source: null, aliases: [] },
  properties: {},
  noteTypeName: 'Runbook',
};

describe('diffVersions', () => {
  it('identical snapshots produce only same lines and no field changes', () => {
    expect(diffVersions(base, base)).toEqual({
      added: 0,
      removed: 0,
      fields: [],
      lines: [
        { kind: 'same', text: 'a' },
        { kind: 'same', text: 'b' },
        { kind: 'same', text: 'c' },
      ],
    });
  });

  it('an edited line shows as removed then added with counts', () => {
    const diff = diffVersions(base, { ...base, contentText: 'a\nB\nc' });
    expect(diff.lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
    ]);
    expect([diff.added, diff.removed]).toEqual([1, 1]);
  });

  it('long unchanged runs collapse to a skipped row keeping three lines of context', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const after = [...lines.slice(0, 19), 'baru'].join('\n');
    const diff = diffVersions({ ...base, contentText: lines.join('\n') }, { ...base, contentText: after });
    expect(diff.lines[0]).toEqual({ kind: 'skipped', count: 16 });
    expect(diff.lines.slice(1, 4).map((l) => ('text' in l ? l.text : ''))).toEqual(['l16', 'l17', 'l18']);
  });

  it('collapses a long run between two changes and keeps context on both sides', () => {
    const middle = Array.from({ length: 12 }, (_, i) => `m${i}`);
    const before = ['x', ...middle, 'y'].join('\n');
    const after = ['X', ...middle, 'Y'].join('\n');
    const diff = diffVersions({ ...base, contentText: before }, { ...base, contentText: after });
    const kinds = diff.lines.map((l) => (l.kind === 'skipped' ? `skipped:${l.count}` : l.kind));
    expect(kinds).toEqual([
      'removed', 'added', 'same', 'same', 'same', 'skipped:6', 'same', 'same', 'same', 'removed', 'added',
    ]);
  });

  it('keeps a trailing line without a newline equal on both sides', () => {
    const diff = diffVersions({ ...base, contentText: 'a\nc' }, { ...base, contentText: 'a\nc\nd' });
    expect(diff.lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('context and type changes are listed before properties in a fixed order', () => {
    const diff = diffVersions(base, {
      ...base,
      title: 'Rollback 16',
      noteTypeName: 'Referensi',
      context: { ...base.context, summary: 'Ringkas', aliases: ['balikin db'] },
      properties: { risk: 'tinggi' },
    });
    expect(diff.fields.map((f) => f.field)).toEqual(['title', 'noteType', 'summary', 'aliases', 'property:risk']);
    expect(diff.fields.at(-1)).toEqual({ field: 'property:risk', before: '', after: 'tinggi' });
  });

  it('lists changed properties alphabetically over the keys of both sides', () => {
    const diff = diffVersions(
      { ...base, properties: { zeta: 1, alpha: 'a' } },
      { ...base, properties: { alpha: 'a', beta: true, zeta: 2 } },
    );
    expect(diff.fields).toEqual([
      { field: 'property:beta', before: '', after: 'true' },
      { field: 'property:zeta', before: '1', after: '2' },
    ]);
  });

  it('an empty before counts every line as added', () => {
    expect(diffVersions({ ...base, contentText: '' }, base).added).toBe(3);
  });

  it('a type that no longer exists shows as an empty name', () => {
    const diff = diffVersions({ ...base, noteTypeName: null }, base);
    expect(diff.fields).toEqual([{ field: 'noteType', before: '', after: 'Runbook' }]);
  });
});

describe('formatPropertyValue', () => {
  it('formats every json value', () => {
    expect([
      formatPropertyValue(3),
      formatPropertyValue(null),
      formatPropertyValue(['a', 2]),
      formatPropertyValue({ b: 1, a: 2 }),
    ]).toEqual(['3', '', 'a, 2', '{"a":2,"b":1}']);
  });
});
