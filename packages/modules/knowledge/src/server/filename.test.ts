import { describe, expect, it } from 'vitest';
import { normalizeFilename } from './filename';

describe('normalizeFilename', () => {
  it('strips path parts and control characters', () => {
    expect(normalizeFilename('../../etc/passwd')).toBe('passwd');
    expect(normalizeFilename('C:\\Users\\a\\laporan "final".pdf')).toBe('laporan "final".pdf');
    expect(normalizeFilename('catatan\u0000 😀\u200b ü.txt')).toBe('catatan 😀 ü.txt');
    expect(normalizeFilename('   ')).toBe('lampiran');
    const long = normalizeFilename(`${'a'.repeat(300)}.docx`);
    expect([...long].length).toBe(255);
    expect(long.endsWith('.docx')).toBe(true);
  });

  it('falls back when nothing but a path separator is left', () => {
    expect(normalizeFilename('folder/')).toBe('lampiran');
    expect(normalizeFilename('')).toBe('lampiran');
  });

  it('composes to NFC so the same name always compares equal', () => {
    expect(normalizeFilename('re\u0301sume\u0301.pdf')).toBe('résumé.pdf');
  });

  it('collapses runs of whitespace and trims the ends', () => {
    expect(normalizeFilename('  laporan \t  akhir .pdf ')).toBe('laporan akhir .pdf');
  });

  it('cuts a long name without an extension and a name whose extension is not an extension', () => {
    expect([...normalizeFilename('b'.repeat(400))].length).toBe(255);
    const odd = normalizeFilename(`${'c'.repeat(300)}.${'d'.repeat(40)}`);
    expect([...odd].length).toBe(255);
  });

  it('never cuts a surrogate pair in half', () => {
    const name = normalizeFilename(`${'😀'.repeat(300)}.png`);
    expect([...name].length).toBe(255);
    expect(name.endsWith('.png')).toBe(true);
    expect(name.isWellFormed()).toBe(true);
  });
});
