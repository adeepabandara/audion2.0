import react from '@vitejs/plugin-react';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@ext': join(here, '../extension/src') } },
  test: {
    environment: 'jsdom',
    setupFiles: [join(here, '../extension/src/test-setup.ts')],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('http://localhost:8080') },
});
