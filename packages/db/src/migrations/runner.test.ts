import { noopLogger } from '@archlin/testing/fakes';
import { describe, expect, it } from 'vitest';
import { PLATFORM_NAMESPACE, qualifiedMigrationNames, runMigrations } from './index';
import type { NamespacedMigrations } from './index';

const noop = { up: async () => undefined };
const set = (namespace: string, names: string[]): NamespacedMigrations => ({
  namespace,
  migrations: Object.fromEntries(names.map((name) => [name, noop])),
});

// Nothing listens here: reaching the network would fail with ECONNREFUSED instead of the validation message.
const UNREACHABLE = 'postgres://nobody:nothing@127.0.0.1:1/none';
const run = (sets: NamespacedMigrations[]) =>
  runMigrations({ connectionString: UNREACHABLE, sets, logger: noopLogger });

describe('qualifiedMigrationNames', () => {
  it('orders by namespace position first, then by local name', () => {
    expect(
      qualifiedMigrationNames([
        set(PLATFORM_NAMESPACE, ['202611111300_c', '202611111200_a']),
        set('fixture', ['202601010000_z', '202601010000_y']),
      ]),
    ).toEqual([
      'platform:202611111200_a',
      'platform:202611111300_c',
      'fixture:202601010000_y',
      'fixture:202601010000_z',
    ]);
  });
});

describe('runMigrations validation', () => {
  it('rejects a first set that is not platform before opening a connection', async () => {
    await expect(run([set('fixture', ['202601010000_b'])])).rejects.toThrow(/first migration set must be/i);
  });

  it('rejects an empty list of sets', async () => {
    await expect(run([])).rejects.toThrow(/first migration set must be/i);
  });

  it('rejects a duplicated namespace', async () => {
    await expect(run([set(PLATFORM_NAMESPACE, []), set('fixture', []), set('fixture', [])])).rejects.toThrow(
      /duplicate migration namespace "fixture"/i,
    );
  });

  it.each(['2026_a', '202611111200_A', '202611111200', '202611111200-a', '202611111200_'])(
    'rejects the local name %s',
    async (name) => {
      await expect(run([set(PLATFORM_NAMESPACE, [name])])).rejects.toThrow(/invalid migration name/i);
    },
  );

  it('rejects a namespace that could break the qualified name format', async () => {
    await expect(run([set(PLATFORM_NAMESPACE, []), set('bad:ns', [])])).rejects.toThrow(
      /invalid migration namespace/i,
    );
  });
});
