import { createStart } from '@tanstack/react-start';
import { appErrorAdapter } from './server/errors';
import { bodyLimitMiddleware, csrfMiddleware, requestContextMiddleware } from './server/request-middleware';

export const startInstance = createStart(() => ({
  requestMiddleware: [requestContextMiddleware, bodyLimitMiddleware, csrfMiddleware],
  serializationAdapters: [appErrorAdapter],
}));
