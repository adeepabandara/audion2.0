import {
  API_ORIGIN,
  FAKE_MEET,
  ONE_SIGN,
  expect,
  installPeakMeter,
  peak,
  playFrames,
  resetPeak,
  state,
  test,
  waitForState,
} from '../../helpers/ext';

test('sign -> sentence -> Ola voice in the call -> caption -> summary, with only /v1 traffic', async ({
  page,
  context,
  requests,
}) => {
  await page.goto(FAKE_MEET);

  // The pill is mounted in a Shadow root, above the control bar.
  const pill = page.getByRole('group', { name: 'Ola' });
  await expect(pill).toBeVisible();
  const pillBox = (await pill.boundingBox())!;
  const barBox = (await page.getByRole('toolbar', { name: 'Call controls' }).boundingBox())!;
  expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(barBox.y); // never over Meet's controls

  // Join: fake Meet asks for camera + microphone and receives Ola's mixed track.
  await page.getByRole('button', { name: 'Join call' }).click();
  await expect(page.locator('#selfVideo')).toHaveJSProperty('paused', false);
  await installPeakMeter(page);

  await pill.getByRole('switch', { name: 'Ola' }).click();
  await waitForState(page, (s) => s.on && s.phase === 'ready');
  await page.waitForTimeout(600);
  await resetPeak(page);
  expect(await peak(page)).toBeLessThan(0.01); // silent microphone: nothing is being sent yet

  // A deliberate sign, then the hands go down: pause -> compose -> speak.
  await playFrames(page, [...ONE_SIGN, { kind: 'none', ms: 2600 }]);
  const spoken = await waitForState(
    page,
    (s) => !!s.caption && s.chips.length === 0 && !s.speaking,
    30_000,
  );
  expect(spoken.caption).toMatch(/^[A-Z].*[.?]$/);
  expect(await peak(page)).toBeGreaterThan(0.05); // Ola's voice reached the outgoing microphone track

  // The caption bar is visible and announced politely.
  const caption = page.getByRole('status', { name: 'Ola caption' });
  await expect(caption).toContainText(spoken.caption!);
  await expect(caption).toHaveAttribute('aria-live', 'polite');

  // Leaving the call turns Ola off and offers the transcript.
  await page.getByRole('button', { name: 'Leave call' }).click();
  const summary = page.getByRole('region', { name: 'Call summary' });
  await expect(summary).toBeVisible();
  await expect(summary.getByRole('listitem')).toHaveCount(1);
  await expect(summary.getByRole('listitem')).toContainText(spoken.caption!);
  expect((await state(page))!.on).toBe(false);

  await summary.getByRole('button', { name: 'Copy' }).click();
  await expect(summary.getByText('Copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    new RegExp(`\\] ${spoken.caption!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  );
  await summary.getByRole('button', { name: 'Close' }).click();
  await expect(summary).toBeHidden();

  // Network audit: the page talks to fake Meet, the extension talks only to /v1/* (and /healthz) on the API.
  const hosts = new Set<string>();
  const apiPaths = new Set<string>();
  for (const r of requests) {
    const u = new URL(r.url());
    if (u.protocol === 'chrome-extension:' || u.protocol === 'data:' || u.protocol === 'blob:')
      continue;
    hosts.add(u.origin);
    if (u.origin === API_ORIGIN) apiPaths.add(u.pathname);
  }
  expect([...hosts].sort()).toEqual([API_ORIGIN, 'http://localhost:4173'].sort());
  expect([...apiPaths].sort()).toEqual([
    '/healthz',
    '/v1/compose',
    '/v1/recognize',
    '/v1/session',
    '/v1/speak',
  ]);
  for (const p of apiPaths) expect(p === '/healthz' || p.startsWith('/v1/')).toBe(true);
  // Clips are small and sent only to /v1/recognize.
  for (const r of requests.filter((r) => new URL(r.url()).pathname === '/v1/recognize')) {
    expect(r.method()).toBe('POST');
    expect(r.postDataBuffer()?.length ?? 0).toBeLessThan(2 * 1024 * 1024);
  }
  void context;
});
