import { describe, expect, it } from 'vitest';
import { deriveTypeKey } from './type-key';

describe('deriveTypeKey', () => {
  it("deriveTypeKey('Catatan Rapat', ∅) === 'catatan_rapat'", () => {
    expect(deriveTypeKey('Catatan Rapat', new Set())).toBe('catatan_rapat');
  });

  it("deriveTypeKey('2026 Rencana', ∅) === 'tipe_2026_rencana'", () => {
    expect(deriveTypeKey('2026 Rencana', new Set())).toBe('tipe_2026_rencana');
  });

  it("deriveTypeKey('Runbook', {'runbook'}) === 'runbook_2'", () => {
    expect(deriveTypeKey('Runbook', new Set(['runbook']))).toBe('runbook_2');
  });

  it("deriveTypeKey('🚀', ∅) === 'tipe'", () => {
    expect(deriveTypeKey('🚀', new Set())).toBe('tipe');
  });
});
