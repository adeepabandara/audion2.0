import { recommendProfiles, type VoiceAnswers } from '../../../packages/shared/src/voiceProfile';
import { getVoice } from '../../../packages/shared/src/voices';
import { FAKE_MEET, expect, extensionId, test } from '../../helpers/ext';

test('install opens the welcome page; onboarding completes and saves settings', async ({
  context,
  page,
  requests,
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

  await expect(w.getByRole('heading', { name: 'Sign. Be heard in any video call.' })).toBeVisible();
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

  // Steps 2 and 3: voice set-up (five questions -> suggested voices) and calibration.
  await expect(w.getByText('Steps 2 and 3 of 3')).toBeVisible();
  await expect(w.getByRole('heading', { name: 'Set up your voice' })).toBeVisible();
  const finish = w.getByRole('button', { name: 'Finish setup' });
  await expect(finish).toBeDisabled();

  const answers: VoiceAnswers = {
    sound: 'masculine',
    age: 'adult',
    pace: 'brisk',
    tone: 'warm',
    accent: 'uk',
  };
  const answer = (question: string, option: string) =>
    w.getByRole('radiogroup', { name: question }).getByRole('radio', { name: option }).click();
  await answer('How should your voice sound?', 'Masculine');
  await answer('How old should it feel?', 'Adult');
  await answer('How fast do you like to talk?', 'Brisk');
  await answer('What tone suits you?', 'Warm');
  await answer('Which English accent?', 'British');

  // The suggestions follow the answers; pick the second one.
  const suggested = recommendProfiles(answers);
  const suggestions = w.getByRole('radiogroup', { name: 'Suggested voices' }).getByRole('radio');
  await expect(suggestions).toHaveCount(suggested.length);
  const chosen = suggested[1]!;
  const chosenLabel = getVoice(chosen.voiceId)!.label;
  await w.getByRole('radio', { name: chosenLabel, exact: true }).check();
  // The voice is described in words for someone who cannot hear it.
  await expect(w.getByText(/brisk pace, British accent/)).toBeVisible();

  // A voice sample plays through the real API (mock mode returns a tone; the call goes through the service worker).
  const calls = (path: string) =>
    requests.filter((r) => new URL(r.url()).pathname === path && r.method() === 'POST').length;
  await w.getByRole('button', { name: 'Hear it' }).click();
  await expect.poll(() => calls('/v1/speak')).toBeGreaterThan(0);

  // "What will people hear?" runs the Speech-to-Text check (the mock API says nothing was really checked).
  await w.getByRole('button', { name: 'What will people hear?' }).click();
  await expect(w.getByText('Test mode: nothing was really checked.')).toBeVisible();
  await expect(w.getByText(/People will hear: “.+”/)).toBeVisible();
  expect(calls('/v1/voice-check')).toBeGreaterThan(0);

  await w.getByRole('button', { name: 'Use this voice' }).click();
  await expect(w.getByRole('status').filter({ hasText: 'Saved as your voice.' })).toBeVisible();

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
  expect(saved).toMatchObject({
    voiceId: chosen.voiceId,
    pitch: chosen.pitch,
    speed: chosen.speed,
    voiceSetupDone: true,
    onboardingDone: true,
  });
  expect(saved.speed as number).toBeGreaterThan(1); // brisk
});
