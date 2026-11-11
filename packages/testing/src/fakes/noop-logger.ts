import type { Logger } from '@archlin/kernel';

// Discards everything; for tests that do not assert on log output.
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
};
