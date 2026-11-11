import { buildRegistry } from '@archlin/kernel';
import { describe, expect, it } from 'vitest';
import { migrationSets, modules } from './archlin.config';

describe('archlin.config', () => {
  it('builds a valid module registry from the configured modules', () => {
    expect(() => buildRegistry(modules.map((m) => m.server))).not.toThrow();
  });

  it('puts platform migrations first', () => {
    expect(migrationSets()[0]?.namespace).toBe('platform');
  });

  it('adds module migrations after platform in module order', () => {
    expect(migrationSets().slice(1).map((s) => s.namespace)).toEqual(modules.map((m) => m.migrations.namespace));
  });
});
