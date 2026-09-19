import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), bootstrap: resolve('src/main/bootstrap.ts') },
      },
    },
  },
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: {
    plugins: [
      react(),
      tailwind(),
      {
        name: 'development-react-refresh-csp',
        apply: 'serve',
        transformIndexHtml: (html) =>
          html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
      },
    ],
  },
});
