import { createRouter } from '@tanstack/react-router';
import { getGlobalStartContext } from '@tanstack/react-start';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  // The nonce exists only during SSR; on the client the context is empty and the scripts are already running.
  const nonce = getGlobalStartContext()?.cspNonce;
  return createRouter({
    routeTree,
    scrollRestoration: true,
    ...(nonce === undefined ? {} : { ssr: { nonce } }),
  });
}
