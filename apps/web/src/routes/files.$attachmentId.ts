import { createFileRoute } from '@tanstack/react-router';
import { fileRouteDeps, handleDownload } from '~/server/file-routes';
import { authedStreamRoute } from '~/server/route-wrappers';

export const Route = createFileRoute('/files/$attachmentId')({
  server: {
    handlers: {
      GET: authedStreamRoute((args) => handleDownload(args, fileRouteDeps())),
    },
  },
});
