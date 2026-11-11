import handler, { createServerEntry } from '@tanstack/react-start/server-entry';
import { getContainer } from './server/container';
import { handleTestRequest } from './server/test-mode';

export default createServerEntry({
  fetch(request, opts) {
    if (new URL(request.url).pathname.startsWith('/__test/')) return handleTestRequest(request, getContainer());
    return handler.fetch(request, opts);
  },
});
