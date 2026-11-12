import { buildRegistry, systemIds } from '@archlin/kernel';
import { describe, expect, it } from 'vitest';
import { migrationSets, moduleDrafts, modules } from './archlin.config';

describe('archlin.config', () => {
  it('builds a valid module registry from the configured modules', () => {
    expect(() => buildRegistry(moduleDrafts({ ids: systemIds }))).not.toThrow();
  });

  it('puts platform migrations first', () => {
    expect(migrationSets()[0]?.namespace).toBe('platform');
  });

  it('adds module migrations after platform in module order', () => {
    expect(migrationSets().slice(1).map((s) => s.namespace)).toEqual(modules.map((m) => m.migrations.namespace));
  });

  it('moduleDrafts builds one draft per entry', () => {
    expect(moduleDrafts({ ids: systemIds })).toEqual([]);
  });
});
