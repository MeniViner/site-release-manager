import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // SharePoint serves the production build from a nested document-library path.
  // Relative assets keep the same dist portable regardless of the final folder.
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4300',
    },
  },
});
