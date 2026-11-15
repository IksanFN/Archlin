import { buildRegistry, systemIds } from '@archlin/kernel';
import { PLATFORM_EVENTS } from '@archlin/platform/server';
import { describe, expect, it } from 'vitest';
import { migrationSets, moduleDrafts, modules } from './archlin.config';

describe('archlin.config', () => {
  it('builds a valid module registry from the configured modules', () => {
    expect(() => buildRegistry(moduleDrafts({ ids: systemIds }), PLATFORM_EVENTS)).not.toThrow();
  });

  it('puts platform migrations first', () => {
    expect(migrationSets()[0]?.namespace).toBe('platform');
  });

  it('adds module migrations after platform in module order', () => {
    expect(migrationSets().slice(1).map((s) => s.namespace)).toEqual(modules.map((m) => m.migrations.namespace));
  });

  it('moduleDrafts builds one draft per entry', () => {
    const drafts = moduleDrafts({ ids: systemIds });
    expect(drafts).toHaveLength(modules.length);
    expect(drafts[0]).toMatchObject({
      id: 'kb',
      entityKinds: { page: { label: 'Halaman', icon: 'file-text', treeable: true } },
    });
  });
});
