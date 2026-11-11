import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 3000, strictPort: true },
  resolve: { tsconfigPaths: true },
  // The argon2 binding is a native .node file: it must be loaded from node_modules at runtime, not bundled.
  ssr: { external: ['@node-rs/argon2'] },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({
      traceDeps: ['@node-rs/argon2'],
      plugins: [fileURLToPath(new URL('./src/boot-guard.ts', import.meta.url))],
    }),
    viteReact(),
  ],
});
