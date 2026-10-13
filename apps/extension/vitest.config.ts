import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('http://localhost:8080') },
});
