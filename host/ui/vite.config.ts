import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'host/ui',
  plugins: [react()],
  server: {
    port: 18766,
    proxy: {
      '/api': 'http://127.0.0.1:18765',
      '/fill': 'http://127.0.0.1:18765',
      '/approve': 'http://127.0.0.1:18765',
      '/reject': 'http://127.0.0.1:18765',
      '/healthz': 'http://127.0.0.1:18765',
      '/container': 'http://127.0.0.1:18765',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: true,
  },
});
