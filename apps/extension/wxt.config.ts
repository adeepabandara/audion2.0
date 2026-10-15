import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'wxt';

// The API origin is a build-time setting: it becomes both a host permission and the only
// network origin the extension pages may connect to.
const apiUrl = process.env.VITE_API_URL ?? 'http://localhost:8080';
const apiOrigin = new URL(apiUrl).origin;

const FAKE_MEET = process.env.AUDION_FAKE_MEET === '1';
const PAGE_MATCHES = [
  'https://meet.google.com/*',
  ...(FAKE_MEET ? ['http://localhost:4173/*'] : []),
];

// MediaPipe's WASM runtime ships in node_modules; copy only the SIMD build (Chrome 91+) so we bundle ~12 MB, not ~36 MB.
const mediapipeDir = dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision'));
const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];

export default defineConfig({
  srcDir: 'src',
  vite: () => ({
    plugins: [react()],
    // Entry points read these flags both when WXT evaluates them in Node (manifest matches) and at runtime in the
    // browser, where `process` does not exist, so they must be replaced at build time.
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
      'process.env.AUDION_FAKE_MEET': JSON.stringify(process.env.AUDION_FAKE_MEET ?? ''),
      'process.env.AUDION_E2E': JSON.stringify(process.env.AUDION_E2E ?? ''),
      'process.env.AUDION_WEB': JSON.stringify(''),
    },
  }),
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const f of WASM_FILES) {
        files.push({ absoluteSrc: join(mediapipeDir, 'wasm', f), relativeDest: `wasm/${f}` });
      }
    },
  },
  manifest: {
    // Optional stable extension ID for local/dev builds (see docs/extension-id.md). Never set for a Web Store upload.
    ...(process.env.EXTENSION_KEY ? { key: process.env.EXTENSION_KEY } : {}),
    name: 'Ola by Audion',
    description: 'Sign. Be heard in any Google Meet call.',
    permissions: ['storage'],
    host_permissions: [`${apiOrigin}/*`],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    // The hand tracker runs in an extension-origin iframe (a content script cannot start an extension Worker).
    web_accessible_resources: [{ resources: ['tracker.html'], matches: PAGE_MATCHES }],
    content_security_policy: {
      extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' ${apiOrigin}; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'`,
    },
  },
});
