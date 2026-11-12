import { defineConfig } from 'tsdown';

// Everything is bundled so the Docker image can run the output without node_modules.
export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  noExternal: [/.*/],
  // pg-native is an optional driver nobody installs. @opentelemetry/api is imported unconditionally by pg-boss and does
  // nothing without an SDK, so it is bundled rather than left for a node_modules the image does not have.
  external: ['pg-native'],
});
