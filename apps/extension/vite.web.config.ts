import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The public web demo: web/index.html (landing page + the Ola panel) and web/tracker.html (the hidden hand-tracker
// page the panel embeds). Output goes to dist-web/, which the API serves (apps/api, WEB_DIR). Same origin as the API,
// so VITE_API_URL stays empty unless you host the page somewhere else.
const here = dirname(fileURLToPath(import.meta.url));
const mediapipeDir = dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision'));
// The Gemma runtime's WebAssembly files (the package has no "exports" entry for them, so find its folder via package.json).
const litertWasmDir = join(
  dirname(createRequire(import.meta.url).resolve('@litert-lm/core/package.json')),
  'wasm',
);

/** MediaPipe's WASM runtime and the hand model, served next to tracker.html (the tracker loads them by relative URL). */
function copyMediaPipe(): Plugin {
  return {
    name: 'copy-mediapipe',
    closeBundle() {
      const out = join(here, 'dist-web');
      mkdirSync(join(out, 'wasm'), { recursive: true });
      mkdirSync(join(out, 'models'), { recursive: true });
      for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
        cpSync(join(mediapipeDir, 'wasm', f), join(out, 'wasm', f));
      }
      cpSync(litertWasmDir, join(out, 'litert'), { recursive: true });
      // The extension's own icons, shown in the browser bar of the simulated window.
      cpSync(join(here, 'public/icon'), join(out, 'icon'), { recursive: true });
      // The on-device sign classifier's weights (the tracker loads models/signclf.json next to tracker.html).
      cpSync(join(here, 'public/models/signclf.json'), join(out, 'models/signclf.json'));
      cpSync(
        join(here, 'public/models/hand_landmarker.task'),
        join(out, 'models/hand_landmarker.task'),
      );
    },
  };
}

export default defineConfig({
  root: join(here, 'web'),
  // web/public holds the looped videos of the other people in the call window (call/person*.mp4).
  publicDir: join(here, 'web/public'),
  plugins: [react(), copyMediaPipe()],
  define: {
    'process.env.AUDION_WEB': '"1"',
    'process.env.AUDION_FAKE_MEET': '""',
    'process.env.AUDION_E2E': '""',
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL ?? ''),
  },
  build: {
    outDir: join(here, 'dist-web'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: join(here, 'web/index.html'),
        tracker: join(here, 'web/tracker.html'),
      },
    },
  },
});
