// Takes a PNG of every tile in the UI gallery (and the Settings drawer tabs) with the Chromium that Playwright already has.
// Usage: pnpm --filter @audion/extension build:gallery && node apps/extension/scripts/gallery-shots.mjs
// Writes ui-components/screenshots/{dark,light}/<section>/<NN-name>.png. No network, no camera.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const requireFromE2e = createRequire(join(root, 'e2e/package.json'));
const { chromium } = requireFromE2e('@playwright/test');

const page_url = pathToFileURL(join(root, 'ui-components/index.html')).href;
const out = join(root, 'ui-components/screenshots');
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

rmSync(out, { recursive: true, force: true });
const browser = await chromium.launch();
let count = 0;

for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 900 },
    colorScheme: scheme,
    reducedMotion: 'reduce', // still frames: no shimmer or entrance halfway through
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(page_url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('figure.tile');
  // The sticky menu would cover the top of tall pictures.
  await page.addStyleTag({ content: '.gallery .nav { display: none !important; }' });
  await page.waitForTimeout(400);

  // One PNG per tile, grouped by section.
  for (const section of await page.locator('main > section').all()) {
    const id = await section.getAttribute('id');
    const tiles = section.locator('figure.tile');
    const n = await tiles.count();
    for (let i = 0; i < n; i++) {
      const tile = tiles.nth(i);
      const title = await tile.locator('figcaption strong').innerText();
      const dir = join(out, scheme, id);
      mkdirSync(dir, { recursive: true });
      await tile.scrollIntoViewIfNeeded();
      await tile.screenshot({
        path: join(dir, `${String(i + 1).padStart(2, '0')}-${slug(title)}.png`),
      });
      count++;
    }
  }

  // The parts that are not tiles: whole sections.
  for (const id of ['signs', 'summary', 'components']) {
    const dir = join(out, scheme, id);
    mkdirSync(dir, { recursive: true });
    const section = page.locator(`#${id}`);
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: join(dir, `00-${id}.png`) });
    count++;
  }

  // The Settings drawer, one picture per tab.
  // Taller than the page needs, so the drawer's long tabs show in full.
  await page.setViewportSize({ width: 1360, height: 1800 });
  await page.getByRole('button', { name: 'Open the Settings drawer' }).click();
  await page.waitForTimeout(500);
  const tabs = page.getByRole('dialog').getByRole('tab');
  const names = await tabs.allInnerTexts();
  const dir = join(out, scheme, 'settings');
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < names.length; i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(250);
    await page.getByRole('dialog').screenshot({
      path: join(dir, `${String(i + 1).padStart(2, '0')}-${slug(names[i])}.png`),
    });
    count++;
  }
  await ctx.close();
}

await browser.close();
console.log(`${count} screenshots in ${out}`);
