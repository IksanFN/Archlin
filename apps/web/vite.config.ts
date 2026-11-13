import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { LARGE_BODY_FUNCTION_IDS } from './src/server/limits.ts';

export default defineConfig({
  server: { port: 3000, strictPort: true },
  resolve: { tsconfigPaths: true },
  build: {
    // The CSP has no font-src, so a font inlined as a data: URI is blocked. Fonts must stay separate same-origin files.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  // The argon2 binding is a native .node file: it must be loaded from node_modules at runtime, not bundled.
  ssr: { external: ['@node-rs/argon2'] },
  plugins: [
    tailwindcss(),
    // Stable ids so the request middleware can raise the body cap for page saves.
    tanstackStart({
      serverFns: {
        generateFunctionId: ({ filename, functionName }) => {
          const file = filename.replaceAll('\\', '/');
          // Vite root is apps/web, so the path is `src/server/functions/pages.ts` (no leading slash).
          if (!(file.endsWith('/src/server/functions/pages.ts') || file === 'src/server/functions/pages.ts')) return undefined;
          // The compiler appends `_createServerFn_handler` to the exported name.
          const exported = functionName.replace(/_createServerFn_handler$/, '') as keyof typeof LARGE_BODY_FUNCTION_IDS;
          return LARGE_BODY_FUNCTION_IDS[exported];
        },
      },
    }),
    nitro({
      traceDeps: ['@node-rs/argon2'],
      plugins: [fileURLToPath(new URL('./src/boot-guard.ts', import.meta.url))],
    }),
    viteReact(),
  ],
});
