import react from '@vitejs/plugin-react';
import { defineConfig } from 'wxt';

// The API origin is a build-time setting: it becomes both a host permission and the only
// network origin the extension pages may connect to.
const apiUrl = process.env.VITE_API_URL ?? 'http://localhost:8080';
const apiOrigin = new URL(apiUrl).origin;

export default defineConfig({
  srcDir: 'src',
  vite: () => ({
    plugins: [react()],
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl) },
  }),
  manifest: {
    name: 'Audion',
    description: 'Sign. Be heard in any Google Meet call.',
    permissions: ['storage'],
    host_permissions: [`${apiOrigin}/*`],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    content_security_policy: {
      extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' ${apiOrigin}; img-src 'self' data:; style-src 'self' 'unsafe-inline'`,
    },
  },
});
