import type { Logger } from '@archlin/kernel';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { OUTBOX_QUEUE, OUTBOX_QUEUE_OPTIONS } from './job-queue';

// Run by apps/migrate with the migrator credential: it owns the pg-boss schema, so the web and worker processes
// (cortex_app) never need DDL rights.
const GRANTS = [
  'GRANT USAGE ON SCHEMA pgboss TO cortex_app',
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO cortex_app',
  'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO cortex_app',
  'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO cortex_app',
];

export async function bootstrapQueue(options: { connectionString: string; logger: Logger }): Promise<void> {
  const { connectionString, logger } = options;
  const boss = new PgBoss({ connectionString, schema: 'pgboss', migrate: true, createSchema: true, supervise: false, schedule: false });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss bootstrap error'));
  await boss.start();
  try {
    if ((await boss.getQueue(OUTBOX_QUEUE)) === null) {
      await boss.createQueue(OUTBOX_QUEUE, OUTBOX_QUEUE_OPTIONS);
      logger.info({ queue: OUTBOX_QUEUE }, 'created queue');
    }
  } finally {
    await boss.stop();
  }

  // Granted again on every run: a queue added by a later module creates new tables or functions.
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const statement of GRANTS) await client.query(statement);
  } finally {
    await client.end();
  }
  logger.info({ schema: 'pgboss' }, 'queue bootstrap finished');
}
