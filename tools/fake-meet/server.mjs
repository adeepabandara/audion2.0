// Tiny static server for the fake Meet page. Usage: pnpm --filter @audion/fake-meet dev  (http://localhost:4173)
// Files come from this folder first, then (so the Audion dev harness can load the hand-tracker page, MediaPipe
// WASM and model) from the built extension in apps/extension/.output/chrome-mv3.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 4173);
const roots = [
  resolve(fileURLToPath(new URL('.', import.meta.url))),
  resolve(fileURLToPath(new URL('../../apps/extension/.output/chrome-mv3', import.meta.url))),
];
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
  '.task': 'application/octet-stream',
};

createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const name = path === '/' ? '/index.html' : path;
  for (const root of roots) {
    const file = resolve(root, `.${name}`);
    if (!file.startsWith(root + sep)) continue; // no path traversal
    if (root === roots[0] && /\.(mjs|json)$/.test(file) && file.endsWith('package.json')) continue; // keep package.json private
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
      return;
    } catch {
      /* try the next root */
    }
  }
  res.writeHead(404).end();
}).listen(port, () => console.log(`fake-meet on http://localhost:${port}`));
