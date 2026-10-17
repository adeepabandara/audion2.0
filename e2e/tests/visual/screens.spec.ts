import type { Page } from '@playwright/test';
import { FAKE_MEET, dispatch, expect, extensionId, test, waitForState } from '../../helpers/ext';

/**
 * Screens 1-11 of the design brief as real pixels, on the real built extension. Baselines are committed for the
 * platform they were made on (macOS); regenerate with `pnpm --filter @audion/e2e update-visual`.
 * Dynamic regions (camera preview, clock times) are masked.
 */
const mask = (page: Page) => [
  page.locator('video'),
  page.locator('canvas'),
  page.locator('time'),
  page.locator('#micMeter'),
];
const shot = async (page: Page, name: string) =>
  expect(page).toHaveScreenshot(`${name}.png`, { mask: mask(page) });

async function meet(page: Page) {
  await page.goto(FAKE_MEET);
  await expect(page.getByRole('group', { name: 'Ola' })).toBeVisible();
  await page.mouse.move(0, 0);
}
const on = async (page: Page) => {
  await dispatch(page, { type: 'TURN_ON' });
  await dispatch(page, { type: 'CAMERA_READY' });
};
const sign = async (page: Page, sign: string, confidence = 0.9) => {
  await dispatch(page, { type: 'CLIP_READY' });
  await dispatch(page, { type: 'RECOGNISED', sign, confidence, threshold: 0.5 });
};
const expand = async (page: Page) => {
  await page.getByRole('button', { name: 'Expand Ola' }).click();
  await expect(page.getByRole('region', { name: 'Ola panel' })).toBeVisible();
};

test.describe('onboarding pages', () => {
  async function welcome(page: Page, context: Parameters<typeof extensionId>[0], hash: string) {
    await page.goto(FAKE_MEET);
    const id = await extensionId(context);
    await page.goto(`chrome-extension://${id}/welcome.html#/${hash}`);
    await page.mouse.move(0, 0);
  }
  test('1 welcome', async ({ page, context }) => {
    await welcome(page, context, 'welcome');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await shot(page, '01-welcome');
  });
  test('2 permissions', async ({ page, context }) => {
    await welcome(page, context, 'permissions');
    await expect(page.getByText('Step 1 of 3')).toBeVisible();
    await expect(page.getByText('Allowed')).toHaveCount(2);
    await shot(page, '02-permissions');
  });
  test('3 setup and calibration', async ({ page, context }) => {
    await welcome(page, context, 'setup');
    await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled({ timeout: 20_000 });
    await shot(page, '03-setup-calibration');
  });
});

test.describe('in the call', () => {
  test('4 pill collapsed', async ({ page }) => {
    await meet(page);
    await shot(page, '04-pill-collapsed');
  });

  test('5 panel expanded with signs and sentence', async ({ page }) => {
    await meet(page);
    await on(page);
    for (const s of ['hello', 'please', 'wait']) await sign(page, s);
    await dispatch(page, { type: 'COMPOSE_START' });
    await dispatch(page, { type: 'COMPOSED', sentence: 'Hello, please wait.' });
    await expand(page);
    await shot(page, '05-panel-expanded');
  });

  test('6 caption bar', async ({ page }) => {
    await meet(page);
    await on(page);
    await sign(page, 'wait');
    await dispatch(page, { type: 'COMPOSE_START' });
    await dispatch(page, { type: 'COMPOSED', sentence: 'Please wait, I’ll talk tomorrow.' });
    await dispatch(page, { type: 'SPEAK_START' });
    await expect(page.getByRole('status', { name: 'Ola caption' })).toBeVisible();
    await shot(page, '06-caption-bar');
  });

  test('7 low-confidence confirm popover', async ({ page }) => {
    await meet(page);
    await on(page);
    await sign(page, 'hello');
    await sign(page, 'tomorrow', 0.3);
    await expect(page.getByRole('dialog', { name: 'Did you mean “tomorrow”?' })).toBeVisible();
    await shot(page, '07-confirm-popover');
  });

  const errors: Array<[string, unknown[], RegExp]> = [
    ['not-recognised', [{ type: 'CLIP_DISCARDED', reason: 'tooShort' }], /Couldn’t recognize that/],
    ['low-light', [{ type: 'LIGHT', dark: true }], /Poor lighting/],
    ['hands-out', [{ type: 'HANDS_EDGE', out: true }], /Hands out of frame/],
    ['offline', [{ type: 'ONLINE', online: false }], /Reconnecting/],
  ];
  for (const [name, events, label] of errors) {
    test(`8 error state: ${name}`, async ({ page }) => {
      await meet(page);
      await on(page);
      for (const e of events) await dispatch(page, e);
      await expand(page);
      await expect(
        page.getByRole('region', { name: 'Ola panel' }).getByText(label).first(),
      ).toBeVisible();
      await shot(page, `08-error-${name}`);
    });
  }

  test('8 error state: camera blocked', async ({ page }) => {
    await meet(page);
    await dispatch(page, { type: 'CAMERA_FAILED', problem: 'blocked' });
    await expect(page.getByRole('button', { name: 'Fix permissions' })).toBeVisible();
    await page.getByRole('button', { name: 'Fix permissions' }).click();
    await shot(page, '08-error-camera-blocked');
  });

  test('9 settings drawer', async ({ page }) => {
    await meet(page);
    await expand(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await shot(page, '09-settings-drawer');
  });

  test('10 supported signs sheet', async ({ page }) => {
    await meet(page);
    await expand(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Signs' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Settings' }).getByRole('tabpanel').getByRole('listitem'),
    ).toHaveCount(22);
    await shot(page, '10-supported-signs');
  });

  test('11 end-of-call summary', async ({ page }) => {
    await meet(page);
    await page.getByRole('button', { name: 'Join call' }).click(); // Ola's voice needs the call's microphone
    await expect(page.locator('#selfVideo')).toHaveJSProperty('paused', false);
    // Switch Ola on for real (not just in the state machine) so its voice channel is enabled.
    await page.getByRole('group', { name: 'Ola' }).getByRole('switch').click();
    await waitForState(page, (s) => s.on && s.phase === 'ready');
    await sign(page, 'hello');
    await sign(page, 'please');
    await dispatch(page, { type: 'COMPOSE_START' });
    await dispatch(page, { type: 'COMPOSED', sentence: 'Hello, please wait.' });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('audion:e2e-speak')));
    await waitForState(page, (s) => !s.speaking && !!s.caption);
    await page.getByRole('button', { name: 'Leave call' }).click();
    await expect(page.getByRole('region', { name: 'Call summary' })).toBeVisible();
    await shot(page, '11-call-summary');
  });
});
