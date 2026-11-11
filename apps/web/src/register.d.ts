import type { getRouter } from './router';
import type { startInstance } from './start';

// Lets the router and server functions see the serialization adapter and the request middleware context.
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
    config: Awaited<ReturnType<typeof startInstance.getOptions>>;
  }
}
