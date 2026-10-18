// Draws Ola's icons: the real "Ola" wordmark (the vector paths in packages/ui/src/components/Wordmark.tsx), white on a
// black rounded square. Nothing is invented: the letters are the supplied logo. Writes public/icon/{ola.svg,16,32,48,128}.png.
// Usage: node apps/extension/scripts/make-icons.mjs   (uses the Chromium Playwright already has; no network)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const out = join(here, '../public/icon');
const { chromium } = createRequire(join(root, 'e2e/package.json'))('@playwright/test');

const source = readFileSync(join(root, 'packages/ui/src/components/Wordmark.tsx'), 'utf8');
const path = (name) => {
  const m = new RegExp(`const ${name} =\\s*'([^']+)'`).exec(source);
  if (!m) throw new Error(`path ${name} not found in Wordmark.tsx`);
  return m[1];
};
const [O, L, A] = ['O', 'L', 'A'].map(path);

// The wordmark's own box is 546 x 275.25; it fills 72% of the icon's width, centred.
const BOX = 512;
const scale = (BOX * 0.72) / 546;
const tx = (BOX - 546 * scale) / 2;
const ty = (BOX - 275.25 * scale) / 2;
const svg = (px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${BOX} ${BOX}">` +
  `<rect width="${BOX}" height="${BOX}" rx="${BOX * 0.22}" fill="#000"/>` +
  `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(5)})" fill="#fff" fill-rule="evenodd">` +
  `<path d="${O}"/><path d="${L}"/><path d="${A}"/></g></svg>`;

writeFileSync(join(out, 'ola.svg'), svg(BOX) + '\n');

const browser = await chromium.launch();
for (const px of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent">${svg(px)}</body>`);
  await page.screenshot({
    path: join(out, `${px}.png`),
    omitBackground: true,
    clip: { x: 0, y: 0, width: px, height: px },
  });
  await page.close();
}
await browser.close();
console.log('icons written to', out);
