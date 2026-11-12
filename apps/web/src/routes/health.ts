import { checkHealth } from '@archlin/platform/server';
import { createFileRoute } from '@tanstack/react-router';
import { getContainer } from '~/server/container';
import { publicRoute } from '~/server/route-wrappers';

// Unauthenticated on purpose (spec 14.4): it reports coarse states only, never versions, hosts or error text.
export const Route = createFileRoute('/health')({
  server: {
    handlers: {
      GET: publicRoute(async () => {
        const { db, expectedMigrations, logger } = getContainer();
        const report = await checkHealth({ db, expectedMigrations, logger });
        const healthy = report.db === 'ok' && report.migrations === 'ok';
        return Response.json(report, { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
      }),
    },
  },
});
