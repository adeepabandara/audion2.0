// Tiny static server for the fake Meet page. Usage: pnpm --filter @audion/fake-meet dev  (http://localhost:4173)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 4173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const name = path === '/' ? '/index.html' : path;
  if (name.includes('..') || !/^\/[\w.-]+$/.test(name)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(fileURLToPath(new URL(`.${name}`, import.meta.url)));
    res.writeHead(200, {
      'content-type': types[name.slice(name.lastIndexOf('.'))] ?? 'text/plain',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`fake-meet on http://localhost:${port}`));
