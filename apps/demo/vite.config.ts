import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The public web demo (apps/demo): pages/index.html (the browser-window demo + the Ola panel) and pages/tracker.html (the
// hidden hand-tracker page the panel embeds). Output goes to dist/, which the API serves (apps/api, WEB_DIR). Same
// origin as the API, so VITE_API_URL stays empty unless you host the page somewhere else.
// The demo reuses the extension's code (panel, hand tracking, classifier) through the `@ext` alias (apps/extension/src)
// and its icons and model files (apps/extension/public); everything that exists only for the demo lives in this folder.
const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, '../extension');
// Packages the extension owns (hand tracking, Gemma) are found from the extension's own folder.
const fromExtension = createRequire(join(extension, 'package.json'));
const mediapipeDir = dirname(fromExtension.resolve('@mediapipe/tasks-vision'));
// The Gemma runtime's WebAssembly files (the package has no "exports" entry for them, so find its folder via package.json).
const litertWasmDir = join(dirname(fromExtension.resolve('@litert-lm/core/package.json')), 'wasm');

/** MediaPipe's WASM runtime and the hand and pose models, served next to tracker.html (the tracker loads them by relative URL). */
function copyMediaPipe(): Plugin {
  return {
    name: 'copy-mediapipe',
    closeBundle() {
      const out = join(here, 'dist');
      mkdirSync(join(out, 'wasm'), { recursive: true });
      mkdirSync(join(out, 'models'), { recursive: true });
      for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
        cpSync(join(mediapipeDir, 'wasm', f), join(out, 'wasm', f));
      }
      cpSync(litertWasmDir, join(out, 'litert'), { recursive: true });
      // The extension's own icons, shown in the browser bar of the simulated window.
      cpSync(join(extension, 'public/icon'), join(out, 'icon'), { recursive: true });
      cpSync(join(extension, 'public/icon/48.png'), join(out, 'favicon.ico')); // browsers ask for /favicon.ico by default
      // The on-device sign classifier's weights (the tracker loads models/signclf.json next to tracker.html).
      cpSync(join(extension, 'public/models/signclf.json'), join(out, 'models/signclf.json'));
      for (const f of ['hand_landmarker.task', 'pose_landmarker_lite.task']) {
        cpSync(join(extension, 'public/models', f), join(out, 'models', f));
      }
    },
  };
}

export default defineConfig({
  root: join(here, 'pages'),
  // public/ holds the demo's own files: logos/, store/ and videos/ (the looped people in the call window).
  publicDir: join(here, 'public'),
  resolve: { alias: { '@ext': join(extension, 'src') } },
  plugins: [react(), copyMediaPipe()],
  define: {
    'process.env.AUDION_WEB': '"1"',
    'process.env.AUDION_FAKE_MEET': '""',
    'process.env.AUDION_E2E': '""',
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL ?? ''),
  },
  build: {
    outDir: join(here, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: join(here, 'pages/index.html'),
        tracker: join(here, 'pages/tracker.html'),
      },
    },
  },
});
