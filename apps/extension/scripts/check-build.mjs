// Usage: node scripts/check-build.mjs   (after `wxt build`; reads .output/chrome-mv3)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkBuild } from './check-build-lib.mjs';

const out = new URL('../.output/chrome-mv3/', import.meta.url).pathname;
const walk = (dir) =>
  readdirSync(dir).flatMap((n) =>
    statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)],
  );

const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
const bundles = Object.fromEntries(
  walk(out)
    .filter((f) => /\.(js|html)$/.test(f) && !f.includes('/wasm/'))
    .map((f) => [relative(out, f), readFileSync(f, 'utf8')]),
);
const problems = checkBuild({
  manifest,
  bundles,
  env: {
    apiOrigin: new URL(process.env.VITE_API_URL ?? 'http://localhost:8080').origin,
    fakeMeet: process.env.AUDION_FAKE_MEET === '1',
    e2e: process.env.AUDION_E2E === '1',
    devKey: !!process.env.EXTENSION_KEY,
  },
});
if (problems.length) {
  console.error(`Build check FAILED (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `Build check passed (${Object.keys(bundles).length} files, permissions: ${manifest.permissions}).`,
);
