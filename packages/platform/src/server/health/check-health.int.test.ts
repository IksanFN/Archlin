import { qualifiedMigrationNames } from '@archlin/db/migrations';
import { createDatabase } from '@archlin/db/runtime';
import { createPlatformDatabase } from '@archlin/testing/db';
import type { Kysely } from 'kysely';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformMigrations } from '../../migrations';
import { checkHealth } from './index';

const expected = qualifiedMigrationNames([platformMigrations]);

let db: Kysely<unknown>;

beforeAll(async () => {
  const urls = await createPlatformDatabase();
  db = createDatabase({ connectionString: urls.app, applicationName: 'health-test', max: 2 });
});
afterAll(async () => {
  await db.destroy();
});

describe('checkHealth', () => {
  it('reports ok when the database is reachable and migrations match', async () => {
    await expect(checkHealth({ db, expectedMigrations: expected })).resolves.toEqual({ db: 'ok', migrations: 'ok' });
  });

  it('reports pending when an expected migration is missing', async () => {
    await expect(checkHealth({ db, expectedMigrations: [...expected, 'platform:209901010000_future'] })).resolves.toEqual({
      db: 'ok',
      migrations: 'pending',
    });
  });

  it('reports unknown_migrations when the database is ahead of the build', async () => {
    await expect(checkHealth({ db, expectedMigrations: expected.slice(0, -1) })).resolves.toEqual({
      db: 'ok',
      migrations: 'unknown_migrations',
    });
  });

  it('reports error when the database is unreachable', async () => {
    const unreachable = createDatabase({
      connectionString: 'postgres://cortex_app:x@127.0.0.1:1/cortex',
      applicationName: 'health-test-down',
      max: 1,
    });
    try {
      await expect(checkHealth({ db: unreachable, expectedMigrations: expected, timeoutMs: 500 })).resolves.toEqual({
        db: 'error',
        migrations: 'error',
      });
    } finally {
      await unreachable.destroy();
    }
  });

  it('reports error instead of hanging when the database does not answer in time', async () => {
    // A socket that is accepted and then never answered, like a database that stalls during startup.
    const sockets: net.Socket[] = [];
    const server = net.createServer((socket) => {
      sockets.push(socket);
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    const stalled = createDatabase({
      connectionString: `postgres://cortex_app:x@127.0.0.1:${port}/cortex`,
      applicationName: 'health-test-stalled',
      max: 1,
    });
    try {
      const started = Date.now();
      await expect(checkHealth({ db: stalled, expectedMigrations: expected, timeoutMs: 300 })).resolves.toEqual({
        db: 'error',
        migrations: 'error',
      });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
      void stalled.destroy();
    }
  });
});
