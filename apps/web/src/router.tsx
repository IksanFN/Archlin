import { createRouter } from '@tanstack/react-router';
import { getGlobalStartContext } from '@tanstack/react-start';
import { ErrorBoundary } from './components/error-boundary';
import { NotFound } from './components/not-found';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  // The nonce exists only during SSR; on the client the context is empty and the scripts are already running.
  const nonce = getGlobalStartContext()?.cspNonce;
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultErrorComponent: ErrorBoundary,
    defaultNotFoundComponent: NotFound,
    ...(nonce === undefined ? {} : { ssr: { nonce } }),
  });
}
