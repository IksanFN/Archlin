import { defineConfig } from 'tsdown';

// Everything is bundled so the Docker image can run the output without node_modules.
export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  noExternal: [/.*/],
  external: ['pg-native', '@opentelemetry/api'],
});
