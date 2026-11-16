import { createFileRoute } from '@tanstack/react-router';
import { fileRouteDeps, handleUpload } from '~/server/file-routes';
import { authedStreamRoute } from '~/server/route-wrappers';

// The body is the raw file, so this route opts out of JSON parsing and reads the stream itself.
export const Route = createFileRoute('/files')({
  server: {
    handlers: {
      POST: authedStreamRoute((args) => handleUpload(args, fileRouteDeps())),
    },
  },
});
