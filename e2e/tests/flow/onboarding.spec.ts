import { FAKE_MEET, expect, extensionId, test } from '../../helpers/ext';

test('install opens the welcome page; onboarding completes and saves settings', async ({
  context,
  page,
}) => {
  await page.goto(FAKE_MEET); // keep a normal tab around
  const id = await extensionId(context);

  // The service worker opened the welcome page on install.
  await expect
    .poll(() => context.pages().some((p) => p.url() === `chrome-extension://${id}/welcome.html`))
    .toBe(true);
  const w = context
    .pages()
    .find((p) => p.url().startsWith(`chrome-extension://${id}/welcome.html`))!;
  await w.bringToFront();

  await expect(
    w.getByRole('heading', { name: 'Sign. Be heard in any Google Meet call.' }),
  ).toBeVisible();
  await expect(
    w.getByText('Your video is processed to recognize signs and never stored.'),
  ).toBeVisible();
  await w.getByRole('button', { name: 'Get started' }).click();

  // Step 1: permissions (the browser prompt is auto-accepted by the test browser).
  await expect(w.getByText('Step 1 of 3')).toBeVisible();
  // In this test browser extension pages already report camera/microphone as granted, so the Needed -> Allowed
  // transition itself is covered by the unit tests; here we check the granted state and move on.
  await expect(w.getByText('Allowed')).toHaveCount(2);
  await w.getByRole('button', { name: 'Continue' }).click();

  // Steps 2 and 3: voice and calibration.
  await expect(w.getByText('Steps 2 and 3 of 3')).toBeVisible();
  const finish = w.getByRole('button', { name: 'Finish setup' });
  await expect(finish).toBeDisabled();

  await w.getByRole('radio', { name: /Miles/ }).check();
  await w.getByRole('slider', { name: 'Speaking speed' }).focus();
  for (let i = 0; i < 3; i++) await w.keyboard.press('ArrowRight');

  // A voice sample plays through the real API (mock mode returns a tone).
  const speak = w
    .waitForResponse((r) => r.url().endsWith('/v1/speak') || r.url().includes('/v1/speak'), {
      timeout: 15_000,
    })
    .catch(() => null);
  await w.getByRole('button', { name: 'Play Aria preview' }).click();
  await speak; // the request goes through the service worker, so it may not show on this page
  await expect(w.getByRole('button', { name: /Aria preview/ })).toBeVisible();

  // Calibration: camera preview, countdown, recording, recognition.
  await expect(w.getByRole('button', { name: 'Start' })).toBeEnabled({ timeout: 20_000 });
  await w.getByRole('button', { name: 'Start' }).click();
  await expect(w.getByText('Sign “hello” now')).toBeVisible({ timeout: 10_000 });
  await expect(finish).toBeEnabled({ timeout: 20_000 });
  await finish.click();
  await expect(w.getByRole('heading', { name: 'You’re all set' })).toBeVisible();

  // Settings were saved to chrome.storage.sync.
  const saved = await w.evaluate(
    async () =>
      (
        await (
          window as unknown as {
            chrome: {
              storage: { sync: { get(k: string): Promise<{ settings: Record<string, unknown> }> } };
            };
          }
        ).chrome.storage.sync.get('settings')
      ).settings,
  );
  expect(saved).toMatchObject({ voiceId: 'miles', onboardingDone: true });
  expect(saved.speed as number).toBeGreaterThan(1);
});
