// Takes the five screenshots shown on the demo's simulated extension page, from the real running demo.
// Usage: pnpm --filter @audion/demo build, start the API with WEB_DIR=../demo/dist (see DEPLOY.md),
// then: node apps/extension/scripts/store-shots.mjs [http://localhost:8099]
// Writes apps/demo/public/store/shot-1..5.png (1280x800). Uses the Chromium Playwright already has. No camera.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const { chromium } = createRequire(join(root, 'e2e/package.json'))('@playwright/test');
const base = process.argv[2] ?? 'http://localhost:8099';
const out = join(here, '../../demo/public/store');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
await page.goto(`${base}/?tour=0`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const shot = (n) => page.screenshot({ path: join(out, `shot-${n}.png`) });

// 1. Ola open in the call.
await page.locator('#toolbar-ola').click();
await page.waitForTimeout(600);
await shot(1);

// 3. Settings, Voice tab (translate to, my voice). 2. The voice setup. 4. The signs.
await page.locator('.ap-foot .au-btn:last-of-type').click();
await page.getByRole('tab', { name: 'Voice' }).waitFor();
await page.waitForTimeout(500);
await shot(3);
await page.getByRole('button', { name: /Set up my voice/ }).click();
await page.waitForTimeout(500);
await shot(2);
await page.getByRole('tab', { name: 'Signs' }).click();
await page.waitForTimeout(500);
await shot(4);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 5. Behind the scenes, with the sample run so there is data flowing.
await page.locator('#open-architecture').click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Play a sample' }).click();
await page.waitForTimeout(3500);
await shot(5);

await browser.close();
console.log('Wrote 5 screenshots to', out);
