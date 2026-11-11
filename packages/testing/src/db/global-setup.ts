import type { TestProject } from 'vitest/node';
import { startTestPostgres } from './test-postgres';
import './urls';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const postgres = await startTestPostgres();
  await postgres.createDatabase('cortex_test');
  project.provide('testDb', postgres.urls('cortex_test'));
  project.provide('testDbServer', { host: postgres.host, port: postgres.port, containerId: postgres.containerId });
  return () => postgres.stop();
}
