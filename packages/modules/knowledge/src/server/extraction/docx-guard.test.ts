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

// The zip library keeps reading directory records while their signature matches and moves every offset by the bytes that
// sit before the end record. A guard that reads the directory differently could vet one set of entries and let another through.
describe('archives read differently by other zip readers', () => {
  const parts = () => zipFixture([{ name: 'a', data: utf8('abc') }, { name: 'b', data: utf8('de') }]);
  const endOf = (bytes: Uint8Array) => bytes.length - 22;
  const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  it('an end record that counts fewer entries than the directory holds is refused', () => {
    const bytes = parts();
    viewOf(bytes).setUint16(endOf(bytes) + 8, 1, true);
    viewOf(bytes).setUint16(endOf(bytes) + 10, 1, true);
    expect(inspectZip(bytes)).toBeNull();
    expect(entriesMatchDeclaredSizes(bytes)).toBe(false);
  });

  it('bytes between the directory and the end record are refused', () => {
    const bytes = parts();
    const padded = new Uint8Array(bytes.length + 10);
    padded.set(bytes.subarray(0, endOf(bytes)), 0);
    padded.set(bytes.subarray(endOf(bytes)), endOf(bytes) + 10);
    expect(inspectZip(padded)).toBeNull();
    expect(entriesMatchDeclaredSizes(padded)).toBe(false);
  });

  it('a directory that stops short of the end record is refused', () => {
    const bytes = parts();
    const size = viewOf(bytes).getUint32(endOf(bytes) + 12, true);
    viewOf(bytes).setUint32(endOf(bytes) + 12, size - 10, true);
    expect(inspectZip(bytes)).toBeNull();
  });

  it('an archive split over several disks is refused', () => {
    const bytes = parts();
    viewOf(bytes).setUint16(endOf(bytes) + 4, 1, true);
    expect(inspectZip(bytes)).toBeNull();
    const other = parts();
    viewOf(other).setUint16(endOf(other) + 6, 1, true);
    expect(inspectZip(other)).toBeNull();
  });

  it('a directory size marker for zip64 counts as over every limit', () => {
    const bytes = parts();
    viewOf(bytes).setUint32(endOf(bytes) + 12, 0xffffffff, true);
    expect(inspectZip(bytes)?.uncompressed).toBe(Infinity);
    expect(entriesMatchDeclaredSizes(bytes)).toBe(false);
  });
});
