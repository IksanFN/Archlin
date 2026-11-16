import { utf8, zipFixture } from '@archlin/testing/files';
import { describe, expect, it } from 'vitest';
import { entriesMatchDeclaredSizes, inspectZip } from './docx-guard';

describe('inspectZip', () => {
  it('reads entry count, total size and ratio', () => {
    expect(inspectZip(zipFixture([{ name: 'a', data: utf8('abc') }, { name: 'b', data: utf8('de') }]))).toEqual({
      entries: 2,
      uncompressed: 5,
      maxRatio: 1,
    });
  });

  it('zip64 markers count as over the limit and a non zip is null', () => {
    expect(inspectZip(zipFixture([{ name: 'a', data: utf8('x'), declaredSize: 0xffffffff }]))?.uncompressed).toBe(Infinity);
    expect(inspectZip(utf8('bukan zip'))).toBeNull();
  });

  it('a declared size far above the stored size shows up as the ratio', () => {
    const archive = inspectZip(zipFixture([{ name: 'a', data: utf8('abcd'), declaredSize: 4000 }]));
    expect(archive).toMatchObject({ entries: 1, uncompressed: 4000, maxRatio: 1000 });
  });

  it('an archive cut inside its central directory is null instead of throwing', () => {
    const bytes = zipFixture([{ name: 'a', data: utf8('abc') }]);
    expect(inspectZip(bytes.slice(0, bytes.length - 30))).toBeNull();
  });

  it('an end record that claims more entries than the file holds is null', () => {
    const bytes = zipFixture([{ name: 'a', data: utf8('abc') }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(bytes.length - 22 + 10, 500, true);
    expect(inspectZip(bytes)).toBeNull();
  });
});

describe('entriesMatchDeclaredSizes', () => {
  it('accepts stored and deflated entries whose real size is the declared one', () => {
    const bytes = zipFixture([
      { name: 'a', data: utf8('abc') },
      { name: 'b', data: utf8('x'.repeat(10_000)), deflate: true },
    ]);
    expect(entriesMatchDeclaredSizes(bytes)).toBe(true);
  });

  it('refuses a deflated entry that grows past the size it declares, without inflating it all', () => {
    const bomb = zipFixture([{ name: 'word/document.xml', data: new Uint8Array(30_000_000), deflate: true, declaredSize: 1000 }]);
    expect(entriesMatchDeclaredSizes(bomb)).toBe(false);
  });

  it('refuses a deflated entry that is smaller than it declares', () => {
    const short = zipFixture([{ name: 'a', data: utf8('x'.repeat(1000)), deflate: true, declaredSize: 5000 }]);
    expect(entriesMatchDeclaredSizes(short)).toBe(false);
  });

  it('refuses a stored entry whose declared size is not its length', () => {
    expect(entriesMatchDeclaredSizes(zipFixture([{ name: 'a', data: utf8('abc'), declaredSize: 99 }]))).toBe(false);
  });

  it('refuses an archive that is not a zip', () => {
    expect(entriesMatchDeclaredSizes(utf8('bukan zip'))).toBe(false);
  });
});
