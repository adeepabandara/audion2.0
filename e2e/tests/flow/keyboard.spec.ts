import type { Page } from '@playwright/test';
import { FAKE_MEET, dispatch, expect, state, test, waitForState } from '../../helpers/ext';

/** The element Ola's UI currently has focused (it lives in a Shadow root). */
const focused = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('audion-root')!.shadowRoot!;
    const el = root.activeElement as HTMLElement | null;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '',
      role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
      outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
    };
  });

const press = async (page: Page, key: string, times = 1) => {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
};

/** Tab until the focused control has this accessible name (bounded: a missing control fails the test). */
async function tabTo(page: Page, name: RegExp, max = 25) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (f && name.test(f.name)) return f;
  }
  throw new Error(`Never reached a control named ${name} by keyboard`);
}

test('the whole panel can be used with the keyboard alone, with visible focus', async ({
  page,
}) => {
  await page.goto(FAKE_MEET);
  await page.getByRole('group', { name: 'Ola' }).getByRole('switch').focus();

  // Space switches Ola On (focus ring visible on the control).
  let f = (await focused(page))!;
  expect(f.role).toBe('switch');
  expect(f.outline).not.toMatch(/^none/);
  await press(page, 'Space');
  await waitForState(page, (s) => s.on && s.phase === 'ready');

  // Tab to Expand, Enter opens the card.
  await tabTo(page, /Expand Ola/);
  await press(page, 'Enter');
  await expect(page.getByRole('region', { name: 'Ola panel' })).toBeVisible();

  // The drag handle moves the panel with arrow keys.
  await tabTo(page, /Move Ola panel/);
  const card = page.getByRole('region', { name: 'Ola panel' });
  const before = (await card.boundingBox())!;
  await press(page, 'ArrowUp', 3);
  const after = (await card.boundingBox())!;
  expect(after.y).toBeLessThan(before.y);

  // Settings: open with Enter, change a choice with arrow keys, close with Escape, focus returns to the button.
  await tabTo(page, /^Settings$/);
  await press(page, 'Enter');
  const drawer = page.getByRole('dialog', { name: 'Settings' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('radio', { name: 'Confirm first' }).focus();
  await press(page, 'Space');
  await expect(drawer.getByRole('radio', { name: 'Confirm first' })).toBeChecked();
  const slider = drawer.getByRole('slider', { name: 'Speaking speed' });
  await slider.focus();
  const v0 = Number(await slider.getAttribute('aria-valuenow'));
  await press(page, 'ArrowRight', 2);
  expect(Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(v0);
  await press(page, 'Escape');
  await expect(drawer).toBeHidden();

  // Supported signs live in Settings > Signs; the tabs work by keyboard.
  await tabTo(page, /^Settings$/);
  await press(page, 'Enter');
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  await sheet.getByRole('tab', { name: 'Voice' }).focus();
  await press(page, 'ArrowRight', 2);
  await expect(sheet.getByRole('tabpanel').getByRole('listitem')).toHaveCount(22);
  await press(page, 'Escape');
  await expect(sheet).toBeHidden();

  // A low-confidence sign: the popover takes focus; Esc = try again, Enter = yes.
  const sendLow = (sign: string) =>
    dispatch(page, { type: 'CLIP_READY' }).then(() =>
      dispatch(page, { type: 'RECOGNISED', sign, confidence: 0.3, threshold: 0.5 }),
    );
  await sendLow('tomorrow');
  const popover = page.getByRole('dialog', { name: 'Did you mean “tomorrow”?' });
  await expect(popover).toBeVisible();
  await expect.poll(async () => (await focused(page))?.name).toMatch(/^Yes/);
  await press(page, 'Escape');
  await expect(popover).toBeHidden();
  expect((await state(page))!.chips).toEqual([]);

  await sendLow('tomorrow');
  await expect(popover).toBeVisible();
  await press(page, 'Enter');
  await expect(popover).toBeHidden();
  expect((await state(page))!.chips).toEqual(['tomorrow:confirmed']);

  // Speak with the keyboard (confirm-first mode was chosen above, so the sentence waits for Speak).
  await tabTo(page, /^Speak$/);
  f = (await focused(page))!;
  expect(f.outline).not.toMatch(/^none/);
  await press(page, 'Enter');
  await waitForState(page, (s) => !!s.caption && !s.speaking, 20_000);
});
