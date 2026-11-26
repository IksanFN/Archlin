import { randomBytes } from 'node:crypto';
import { inject } from 'vitest';
import { buildTestDbUrls } from './urls';
import type { TestDbUrls } from './urls';
import { provisionDatabase } from './test-postgres';

// Runs inside a Vitest worker, where the container object of the global setup is not available:
// the same container is reached by id.
export async function createScratchDatabase(): Promise<TestDbUrls> {
  const server = inject('testDbServer');
  const name = `t_${randomBytes(4).toString('hex')}`;
  await provisionDatabase(server.containerId, name);
  return buildTestDbUrls(server.host, server.port, name);
}
