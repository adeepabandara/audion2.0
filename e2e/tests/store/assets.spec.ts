import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { FAKE_MEET, dispatch, expect, test } from '../../helpers/ext';

const OUT = resolve(import.meta.dirname, '../../../store');
mkdirSync(`${OUT}/screenshots`, { recursive: true });

// An open hand (MediaPipe landmark order) so the preview shows what hand tracking looks like.
const HAND = [
  [0.5, 0.85],
  [0.42, 0.78],
  [0.37, 0.7],
  [0.34, 0.62],
  [0.32, 0.55],
  [0.45, 0.62],
  [0.44, 0.5],
  [0.43, 0.42],
  [0.425, 0.35],
  [0.5, 0.6],
  [0.5, 0.46],
  [0.5, 0.37],
  [0.5, 0.29],
  [0.55, 0.62],
  [0.56, 0.5],
  [0.565, 0.42],
  [0.57, 0.35],
  [0.6, 0.66],
  [0.62, 0.57],
  [0.635, 0.5],
  [0.645, 0.44],
].map(([x, y]) => ({ x, y, z: 0 }));

async function ready(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(FAKE_MEET);
  await expect(page.getByRole('group', { name: 'Audion' })).toBeVisible();
  await page.mouse.move(0, 0);
}
const on = async (page: Page) => {
  await dispatch(page, { type: 'TURN_ON' });
  await dispatch(page, { type: 'CAMERA_READY' });
};
/** A hand in the preview (landmarks only: there is no camera image in a store screenshot). Needs the card open. */
const hand = (page: Page) =>
  page.evaluate((h) => {
    for (let i = 0; i < 2; i++) {
      window.dispatchEvent(
        new CustomEvent('audion:e2e-frame', {
          detail: JSON.stringify({
            t: 1000 + i * 66,
            hands: [{ landmarks: h, handedness: 'Right' }],
          }),
        }),
      );
    }
  }, HAND);
const sign = async (page: Page, s: string, confidence = 0.92) => {
  await dispatch(page, { type: 'CLIP_READY' });
  await dispatch(page, { type: 'RECOGNISED', sign: s, confidence, threshold: 0.5 });
};
const expand = async (page: Page) => {
  await page.getByRole('button', { name: 'Expand Audion' }).click();
  await expect(page.getByRole('region', { name: 'Audion panel' })).toBeVisible();
};
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${OUT}/screenshots/${name}.png` });

test.describe('Chrome Web Store screenshots (1280x800)', () => {
  test('1 sign to sentence', async ({ page }) => {
    await ready(page);
    await on(page);
    for (const s of ['hello', 'please', 'wait']) await sign(page, s);
    await dispatch(page, { type: 'COMPOSE_START' });
    await dispatch(page, { type: 'COMPOSED', sentence: 'Hello, please wait.' });
    await expand(page);
    await hand(page);
    await shot(page, '1-sign-to-sentence');
  });

  test('2 captions', async ({ page }) => {
    await ready(page);
    await on(page);
    await sign(page, 'wait');
    await dispatch(page, { type: 'COMPOSE_START' });
    await dispatch(page, { type: 'COMPOSED', sentence: 'Please wait, I’ll talk tomorrow.' });
    await dispatch(page, { type: 'SPEAK_START' });
    await expect(page.getByRole('status', { name: 'Audion caption' })).toBeVisible();
    await shot(page, '2-captions');
  });

  test('3 confirm a sign', async ({ page }) => {
    await ready(page);
    await on(page);
    await sign(page, 'hello');
    await sign(page, 'tomorrow', 0.3);
    await expect(page.getByRole('dialog', { name: 'Did you mean “tomorrow”?' })).toBeVisible();
    await shot(page, '3-confirm-a-sign');
  });

  test('4 supported signs', async ({ page }) => {
    await ready(page);
    await expand(page);
    await page.getByRole('button', { name: 'Supported signs' }).click();
    await expect(page.getByRole('dialog', { name: 'Supported signs' })).toBeVisible();
    await shot(page, '4-supported-signs');
  });

  test('5 privacy and settings', async ({ page }) => {
    await ready(page);
    await expand(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const drawer = page.getByRole('dialog', { name: 'Settings' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('heading', { name: 'Privacy' }).scrollIntoViewIfNeeded();
    await shot(page, '5-privacy-and-settings');
  });
});

const tile = (
  w: number,
  h: number,
  headline: number,
  sub: number,
) => `<!doctype html><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0}
  body{width:${w}px;height:${h}px;display:grid;place-items:center;font-family:Inter,system-ui,-apple-system,sans-serif;color:#fff;
    background:radial-gradient(120% 140% at 15% 10%,#0f766e 0%,#0b4f4a 45%,#0f1115 100%)}
  main{display:grid;gap:${Math.round(h * 0.06)}px;justify-items:center;text-align:center;padding:0 ${Math.round(w * 0.06)}px}
  .mark{display:flex;align-items:center;gap:${Math.round(h * 0.04)}px;font-weight:800;font-size:${Math.round(headline * 0.8)}px}
  h1{font-size:${headline}px;line-height:1.1;font-weight:800;letter-spacing:-0.02em}
  p{font-size:${sub}px;color:#d7f5ef}
</style>
<main>
  <div class="mark"><svg width="${Math.round(headline * 1.1)}" height="${Math.round(headline * 1.1)}" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#fff"/><circle cx="10" cy="16" r="3.2" fill="#0f766e"/><path d="M16 10.5a7.5 7.5 0 010 11M20.5 7a12.5 12.5 0 010 18" fill="none" stroke="#0f766e" stroke-width="2.4" stroke-linecap="round"/></svg>Audion</div>
  <h1>Sign. Be heard in any Google Meet call.</h1>
  <p>Your video is processed to recognize signs and never stored.</p>
</main>`;

test.describe('promo tiles', () => {
  test('small 440x280 and marquee 1400x560', async ({ page }) => {
    await page.setViewportSize({ width: 440, height: 280 });
    await page.setContent(tile(440, 280, 26, 13));
    await page.screenshot({ path: `${OUT}/promo-small-440x280.png` });
    await page.setViewportSize({ width: 1400, height: 560 });
    await page.setContent(tile(1400, 560, 64, 26));
    await page.screenshot({ path: `${OUT}/promo-marquee-1400x560.png` });
  });
});
