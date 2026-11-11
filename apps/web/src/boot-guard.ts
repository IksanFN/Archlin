import { loadWebEnv, StartupConfigError } from './server/env';

// Nitro loads the SSR bundle on the first request, so module-level checks run too late. A Nitro plugin runs at startup,
// which is where a bad configuration (test mode in production, a migrator secret) has to stop the process (spec 13.4 K8).
export default function bootGuard(): void {
  try {
    loadWebEnv(process.env);
  } catch (err) {
    if (err instanceof StartupConfigError) {
      console.error(`Refusing to start (${err.code}): ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
