import { describe, expect, it } from 'vitest';
import { readThemePreference, resolveTheme, THEME_STORAGE_KEY, themeBootScript } from './theme';

describe('readThemePreference', () => {
  it.each([
    [null, 'system'],
    ['dark', 'dark'],
    ['light', 'light'],
    ['blue', 'system'],
  ] as const)('reads stored preference %j as %s', (stored, expected) => {
    expect(readThemePreference({ getItem: () => stored })).toBe(expected);
  });

  it('falls back to system when storage throws', () => {
    expect(
      readThemePreference({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('system');
  });

  it('falls back to system when storage is unavailable', () => {
    expect(readThemePreference(null)).toBe('system');
  });
});

describe('resolveTheme', () => {
  it.each([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
  ] as const)('resolves %s with prefersDark=%s to %s', (preference, prefersDark, expected) => {
    expect(resolveTheme(preference, prefersDark)).toBe(expected);
  });
});

describe('themeBootScript', () => {
  function run(stored: string | null | 'throws', prefersDark: boolean): string | undefined {
    const documentElement = { dataset: {} as Record<string, string> };
    const localStorage = {
      getItem: () => {
        if (stored === 'throws') throw new Error('blocked');
        return stored;
      },
    };
    const window = { matchMedia: () => ({ matches: prefersDark }) };
    new Function('document', 'localStorage', 'window', themeBootScript)({ documentElement }, localStorage, window);
    return documentElement.dataset.theme;
  }

  it('follows the system when nothing is stored', () => {
    expect(run(null, true)).toBe('dark');
    expect(run(null, false)).toBe('light');
  });

  it('prefers the stored choice over the system', () => {
    expect(run('light', true)).toBe('light');
    expect(run('dark', false)).toBe('dark');
  });

  it('survives blocked storage', () => {
    expect(run('throws', false)).toBe('light');
  });

  it('stores under the key the settings menu writes', () => {
    expect(THEME_STORAGE_KEY).toBe('archlin.theme');
    expect(themeBootScript).toContain(THEME_STORAGE_KEY);
  });
});
