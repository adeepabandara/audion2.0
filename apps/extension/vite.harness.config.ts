import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  publicDir: false, // don't copy extension icons into tools/fake-meet
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.AUDION_FAKE_MEET': '"1"',
    'process.env.AUDION_E2E': '""',
    'process.env.AUDION_WEB': '""', // only the public web demo build sets this
    'import.meta.env.VITE_API_URL': JSON.stringify(
      process.env.VITE_API_URL ?? 'http://localhost:8080',
    ),
  },
  build: {
    outDir: '../../tools/fake-meet',
    emptyOutDir: false,
    lib: {
      entry: 'dev/harness.tsx',
      formats: ['iife'],
      name: 'AudionHarness',
      fileName: () => 'audion-harness.js',
    },
  },
});
