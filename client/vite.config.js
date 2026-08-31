import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(clientDir, '..');

export default defineConfig({
  // SharePoint serves the production build from a nested document-library path.
  // Relative assets keep the same dist portable regardless of the final folder.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      // The SharePoint provisioning contracts are shared with the Node API and
      // its test-suite, so there is exactly one implementation of them.
      '@shared': path.join(repoRoot, 'shared'),
    },
  },
  server: {
    port: 5173,
    // shared/ lives above the Vite root and must be readable by the dev server.
    fs: { allow: [repoRoot] },
    proxy: {
      '/api': 'http://localhost:4300',
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'https://portal.army.idf/sites/schedule/siteDB/dist/index.html',
      },
    },
    setupFiles: ['./test/setup.js'],
  },
});
