import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The UI gallery: every Ola component and screen, rendered from the real code, as ONE standalone file
// (ui-components/index.html) that opens from disk with a double-click (no server). Build: pnpm --filter @audion/extension build:gallery
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../../ui-components');

/** Put the built script and styles inside index.html, so it works from file:// (module scripts do not). */
function inlineAssets(): Plugin {
  return {
    name: 'inline-assets',
    closeBundle() {
      const assets = join(outDir, 'assets');
      let html = readFileSync(join(outDir, 'index.html'), 'utf8');
      for (const f of readdirSync(assets)) {
        const code = readFileSync(join(assets, f), 'utf8').replace(/<\/script/gi, '<\\/script');
        if (f.endsWith('.js')) {
          html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, '');
          html = html.replace('</body>', () => `<script>${code}</script></body>`);
        } else if (f.endsWith('.css')) {
          html = html.replace(/<link[^>]*stylesheet[^>]*>/, () => `<style>${code}</style>`);
        }
      }
      writeFileSync(join(outDir, 'index.html'), html);
      rmSync(assets, { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  root: join(here, 'gallery'),
  publicDir: false,
  plugins: [react(), inlineAssets()],
  define: {
    'process.env.AUDION_WEB': '"1"',
    'process.env.AUDION_FAKE_MEET': '""',
    'process.env.AUDION_E2E': '""',
    'import.meta.env.VITE_API_URL': '""',
  },
  build: {
    outDir,
    emptyOutDir: false, // README.md and screenshots/ live in the same folder
    cssCodeSplit: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
});
