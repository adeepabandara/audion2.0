import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStore } from '@ext/lib/storage';
import { SIGN_INFO } from '@ext/panel/signs';
import { createPanelStore } from '@ext/panel/store';
import { getBrowser, resetBrowser, setBrowser } from '../browser/browserState';
import { Coach, placePopover, revealInScroller } from './Coach';
import { SIGNS } from '@audion/shared';
import { GLIDE_MS, easeOut, glideFrame, glideSpot } from './glide';
import { GestureList } from './Gestures';
import { SignGuide } from './SignGuide';
import { COACH_STEPS, PRACTICE_SENTENCES, PRACTICE_SIGNS, SIGN_MOTION } from './steps';
import { SLOW_START_MS, Tour } from './Tour';
import * as zoomModule from './zoom';
import { applyZoom, computeZoom, NO_ZOOM, type Matrix } from './zoom';

// The real zoom functions, but with the one that moves the window watched, so a test can count how often it moves.
vi.mock('./zoom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./zoom')>();
  return { ...actual, applyZoom: vi.fn(actual.applyZoom) };
});

const OPEN = COACH_STEPS.findIndex((s) => s.id === 'open');
const VIEW = { w: 1000, h: 700 };
const SIZE = { w: 340, h: 200 };

describe('placePopover', () => {
  it('centres the popover when there is nothing to point at', () => {
    const p = placePopover(null, 'bottom', SIZE, VIEW);
    expect(p).toMatchObject({ left: 330, top: 250, side: 'center' });
  });

  it('puts it on the wanted side when it fits, and keeps it inside the window', () => {
    const target = { left: 100, top: 100, width: 100, height: 40 };
    const p = placePopover(target, 'bottom', SIZE, VIEW);
    expect(p.side).toBe('bottom');
    expect(p.top).toBeGreaterThan(140);
    expect(p.left).toBeGreaterThanOrEqual(12);
  });

  it('takes the side with room when the wanted one is too tight', () => {
    const target = { left: 400, top: 640, width: 100, height: 40 }; // near the bottom edge
    expect(placePopover(target, 'bottom', SIZE, VIEW).side).toBe('top');
    const atRight = { left: 940, top: 300, width: 50, height: 50 };
    expect(placePopover(atRight, 'right', SIZE, VIEW).side).not.toBe('right');
  });
});

describe('the guided steps', () => {
  it('follows install, join, use: eleven steps in that order', () => {
    expect(COACH_STEPS.map((s) => s.id)).toEqual([
      'add',
      'pin',
      'join',
      'open',
      'on',
      'ready',
      'settings',
      'voice',
      'voice-pick',
      'sign',
      'speak',
    ]);
  });

  it('shows an animated pointer on exactly the steps where the visitor must click, and leaves install and play undimmed', () => {
    const clicks = COACH_STEPS.filter((s) => s.demo === 'click').map((s) => s.id);
    expect(clicks).toEqual(['add', 'pin', 'join', 'open', 'on', 'settings', 'voice']);
    // Install and the two steps where the visitor plays are never dimmed or blocked.
    expect(COACH_STEPS.filter((s) => s.focus === false).map((s) => s.id)).toEqual([
      'add',
      'voice-pick',
      'sign',
      'speak',
    ]);
    expect(COACH_STEPS.find((s) => s.id === 'add')!.zoom).toBe(1); // the whole store page stays in view
  });

  it('keeps the popup light: a short title and ONE short line per step, and a zoom for each', () => {
    for (const s of COACH_STEPS) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.title.length).toBeLessThanOrEqual(26);
      expect(s.text.length).toBeGreaterThan(10);
      expect(s.text.length).toBeLessThanOrEqual(56);
      expect(s.zoom).toBeGreaterThanOrEqual(1);
      expect(s.zoom).toBeLessThanOrEqual(2);
      expect(s.target).toBeTruthy();
    }
    // The smallest things (toolbar icons, the pill's button, the cog) are zoomed in the most.
    const zoom = Object.fromEntries(COACH_STEPS.map((s) => [s.id, s.zoom]));
    expect(zoom.pin).toBeGreaterThan(zoom.join!);
    expect(zoom.settings).toBeGreaterThan(zoom.sign!);
    expect(zoom.sign).toBe(1); // no zoom while playing
    // The first look at Ola in the call and the camera steps keep the whole window in view.
    expect(zoom.open).toBe(1);
    expect(zoom.on).toBe(1);
    expect(zoom.ready).toBe(1);
  });

  it('happens on the right page of the browser window', () => {
    const scenes = Object.fromEntries(COACH_STEPS.map((s) => [s.id, s.scene]));
    expect(scenes).toMatchObject({ add: 'store', pin: 'store', join: 'join', open: 'call' });
  });
});

describe('computeZoom', () => {
  const origin = { x: 100, y: 50 };
  const size = { w: 1000, h: 800 };
  const view = { w: 1440, h: 900 };
  const target = { left: 1000, top: 700, width: 120, height: 60 }; // bottom right of the window, measured at 1x

  it('does not zoom for a level of 1 or a target that cannot be measured', () => {
    expect(
      computeZoom({ target, current: NO_ZOOM, origin, size, view, level: 1, side: 'left' }),
    ).toEqual(NO_ZOOM);
    expect(
      computeZoom({
        target: { ...target, width: 0 },
        current: NO_ZOOM,
        origin,
        size,
        view,
        level: 2,
        side: 'left',
      }),
    ).toEqual(NO_ZOOM);
  });

  it('zooms up to the level and never shows blank page around a window bigger than the screen', () => {
    const m = computeZoom({ target, current: NO_ZOOM, origin, size, view, level: 2, side: 'left' });
    expect(m.s).toBe(2);
    expect(m.tx).toBeLessThanOrEqual(-origin.x);
    expect(m.tx).toBeGreaterThanOrEqual(view.w - origin.x - m.s * size.w);
    expect(m.ty).toBeLessThanOrEqual(-origin.y);
    expect(m.ty).toBeGreaterThanOrEqual(view.h - origin.y - m.s * size.h);
  });

  it('centres a window that is still smaller than the screen at that zoom', () => {
    const m = computeZoom({
      target: { left: 400, top: 300, width: 100, height: 50 },
      current: NO_ZOOM,
      origin: { x: 50, y: 20 },
      size: { w: 800, h: 500 },
      view: { w: 1440, h: 900 },
      level: 1.4,
      side: 'bottom',
    });
    expect(m.tx + 50 + (m.s * 800) / 2).toBeCloseTo(1440 / 2);
    expect(m.ty + 20 + (m.s * 500) / 2).toBeCloseTo(900 / 2);
  });

  it('zooms less (or not at all) when the target already fills much of the screen', () => {
    const big = { left: 200, top: 100, width: 1000, height: 500 };
    const m = computeZoom({
      target: big,
      current: NO_ZOOM,
      origin,
      size,
      view,
      level: 2,
      side: 'left',
    });
    expect(m.s).toBeLessThan(2);
  });

  it('gives the same answer whether the target is measured before or part-way through a zoom', () => {
    const first = computeZoom({
      target,
      current: NO_ZOOM,
      origin,
      size,
      view,
      level: 1.6,
      side: 'left',
    });
    // Measure the same target while that zoom is applied (as the window would show it).
    const shown = (m: Matrix) => ({
      left: origin.x + m.tx + m.s * (target.left - origin.x),
      top: origin.y + m.ty + m.s * (target.top - origin.y),
      width: target.width * m.s,
      height: target.height * m.s,
    });
    const again = computeZoom({
      target: shown(first),
      current: first,
      origin,
      size,
      view,
      level: 1.6,
      side: 'left',
    });
    expect(again.s).toBeCloseTo(first.s);
    expect(again.tx).toBeCloseTo(first.tx);
    expect(again.ty).toBeCloseTo(first.ty);
  });

  it('applies and clears a zoom on the element', () => {
    const el = document.createElement('div');
    applyZoom(el, { s: 1.5, tx: -20, ty: -10 }, true);
    expect(el.style.transform).toBe('translate(-20px, -10px) scale(1.5)');
    expect(el.style.transition).toContain('transform');
    applyZoom(el, NO_ZOOM, false);
    expect(el.style.transform).toBe('');
    expect(el.style.transition).toBe('none');
  });
});

function fakeSession() {
  let state = {
    on: false,
    starting: false,
    speaking: false,
    problems: [] as string[],
    chips: [] as unknown[],
    sentence: null as string | null,
  };
  const listeners = new Set<() => void>();
  return {
    session: {
      getState: () => state,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    } as never,
    set(next: Partial<typeof state>) {
      state = { ...state, ...next };
      for (const l of listeners) l();
    },
  };
}

function mount(props: Partial<React.ComponentProps<typeof Tour>> = {}) {
  const panelStore = createPanelStore(memoryStore());
  const fake = fakeSession();
  const view = render(
    <Tour panelStore={panelStore} session={fake.session} shadow={document} {...props} />,
  );
  return { panelStore, fake, ...view };
}
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const heading = (name: string | RegExp) => screen.getByRole('heading', { name });

/** Start the tour and pass the install and join steps by: Ola is then installed and pinned, and the call is on. */
function toTheCall() {
  press('Start the tour');
  for (let i = 0; i < OPEN; i++) press('Skip step');
}

/** The visitor opens Settings, starts the voice questions and picks a voice (Settings are drawn by the widget). */
async function throughTheVoiceSetup() {
  const flush = () => act(async () => void (await Promise.resolve()));
  expect(heading('Open Settings')).toBeTruthy();
  const drawer = document.createElement('div');
  drawer.className = 'au-drawer';
  drawer.innerHTML = '<section aria-label="My voice"><button>Set up my voice</button></section>';
  document.body.append(drawer);
  await flush();
  tick(1000);
  expect(heading('Set up your voice')).toBeTruthy();
  const questions = document.createElement('div');
  questions.className = 'vs';
  drawer.append(questions);
  await flush();
  tick(1000);
  expect(heading('Choose how you sound')).toBeTruthy();
  questions.remove(); // "Use this voice"
  await flush();
  tick(1000);
  drawer.remove();
}

/** Pass every remaining step by, up to (not including) the last one. */
function skipToTheLastStep() {
  for (let i = OPEN; i < COACH_STEPS.length - 1; i++) press(/^(Skip step|Next)$/);
}

/** Through "Add to Chrome" to the end of the install step, then on to the next step. */
function addExtension() {
  press('Add to Chrome');
  press('Add extension');
  tick(1500);
  tick(1000);
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  resetBrowser();
  for (const id of ['scene-store', 'zoomer', 'zoom-anchor', 'browser']) {
    const el = document.createElement('div');
    el.id = id;
    document.body.append(el);
  }
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  resetBrowser();
});

describe('the tour', () => {
  it('opens with a welcome that has one button to start and one quiet way out', () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: /Welcome to Ola/ });
    expect(screen.getByText(/browser extension/)).toBeTruthy();
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Start the tour',
      'Explore on my own',
    ]);
  });

  it('can be skipped, leaves the window finished, and "Take the tour" starts it again', () => {
    mount();
    press('Explore on my own');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('ola:tour')).toBe('skipped');
    expect(getBrowser()).toMatchObject({ scene: 'call', installed: true, pinned: true });
    press('Take the tour');
    expect(screen.getByRole('dialog', { name: /Welcome to Ola/ })).toBeTruthy();
  });

  it('does not start again for someone who has seen it, and never starts when disabled', () => {
    localStorage.setItem('ola:tour', 'done');
    const first = mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Take the tour' })).toBeTruthy();
    first.unmount();
    mount({ force: true });
    expect(screen.getByRole('dialog', { name: /Welcome to Ola/ })).toBeTruthy();
    document.body.innerHTML = '';
    mount({ disabled: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take the tour' })).toBeNull();
  });

  it('"from the start" opens the extension store as a tab in the browser window', () => {
    mount();
    press('Start the tour');
    expect(getBrowser()).toMatchObject({
      scene: 'store',
      installed: false,
      pinned: false,
      storeTab: true,
    });
    expect(screen.getByRole('region', { name: /Ola by Audion, extension page/ })).toBeTruthy();
    expect(
      document
        .getElementById('scene-store')!
        .contains(screen.getByRole('button', { name: 'Add to Chrome' })),
    ).toBe(true);
    expect(heading('Add Ola to your browser')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Step 1 of 11' })).toBeTruthy();
    // It says it is a simulation, and shows no invented ratings or user numbers.
    expect(screen.getByText(/simulation inside the Ola demo/)).toBeTruthy();
    expect(screen.queryByText(/users|ratings|reviews/i)).toBeNull();
  });

  it('asks before adding the extension, and Cancel goes back', () => {
    mount();
    press('Start the tour');
    press('Add to Chrome');
    expect(screen.getByRole('alertdialog', { name: /Add “Ola by Audion”/ })).toBeTruthy();
    press('Cancel');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(getBrowser().installed).toBe(false);
  });

  it('walks install, pin and join, each on its own page of the window', () => {
    mount();
    press('Start the tour');
    addExtension();
    expect(getBrowser().installed).toBe(true);
    expect(heading('Pin Ola')).toBeTruthy();
    expect(getBrowser().scene).toBe('store');

    act(() => setBrowser({ pinned: true }));
    tick(1000);
    expect(heading('Join the meeting')).toBeTruthy();
    expect(getBrowser().scene).toBe('join');

    act(() => setBrowser({ scene: 'call' }));
    tick(1000);
    expect(heading('Ola is in your call')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Step 4 of 11' })).toBeTruthy();
  });

  it('shows where you are with one small dot per step, the current one marked', () => {
    mount();
    press('Start the tour');
    const dots = screen.getByRole('list', { name: 'Step 1 of 11' });
    expect(dots.querySelectorAll('li')).toHaveLength(11);
    expect(dots.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(dots.textContent).toBe('');
  });

  it('never has more than two controls in the popup, and no zoom switch', () => {
    mount();
    press('Start the tour');
    const popup = () => screen.getByRole('dialog', { name: /./ });
    expect([...popup().querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Skip tour',
      'Skip step',
    ]);
    expect(screen.queryByRole('button', { name: /zoom/i })).toBeNull();
    cleanup();
    resetBrowser();
    mount();
    toTheCall();
    skipToTheLastStep();
    expect([...popup().querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Skip tour',
      'Done',
    ]);
  });

  it('passing the install and join steps by lands in the call, with Ola installed and pinned', () => {
    mount();
    toTheCall();
    expect(getBrowser()).toMatchObject({ scene: 'call', installed: true, pinned: true });
    expect(heading('Ola is in your call')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Step 4 of 11' })).toBeTruthy();
  });

  it('moves on by itself as the visitor opens Ola, turns it on, signs a sentence and hears it', async () => {
    const { panelStore, fake } = mount();
    toTheCall();

    act(() => panelStore.useStore.getState().setExpanded(true));
    expect(screen.getByRole('status').textContent).toBe('Done.');
    tick(1000);
    expect(heading('Turn Ola on')).toBeTruthy();

    act(() => fake.set({ on: true, starting: true }));
    tick(1000);
    expect(heading('Camera ready')).toBeTruthy();
    tick(2000);
    expect(heading('Camera ready')).toBeTruthy(); // still starting: it waits

    act(() => fake.set({ starting: false }));
    tick(1000);
    // Settings come next: open them, start the voice questions, choose a voice.
    expect(heading('Open Settings')).toBeTruthy();
    tick(3000);
    expect(heading('Open Settings')).toBeTruthy(); // it waits for the visitor
    await throughTheVoiceSetup();
    expect(heading('Now you try')).toBeTruthy();

    // One sign is not enough: it waits for the whole sentence.
    act(() => fake.set({ chips: [{ sign: 'hello' }] }));
    tick(2000);
    expect(heading('Now you try')).toBeTruthy();

    act(() => fake.set({ sentence: 'Hello, please wait.' }));
    tick(1000);
    expect(heading('Ola speaks for you')).toBeTruthy();

    // It waits until the voice has played, then moves on.
    expect(screen.getByRole('list', { name: 'Step 11 of 11' })).toBeTruthy();
    act(() => fake.set({ speaking: true }));
    tick(2000);
    expect(heading('Ola speaks for you')).toBeTruthy();
    act(() => fake.set({ speaking: false }));
    tick(1000);
    // Playing is the last step: when it is done the tour closes and Ola is left open to play with.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('ola:tour')).toBe('done');
  });

  it('does not wait forever for the voice: it moves on after a few seconds', async () => {
    const { panelStore, fake } = mount();
    toTheCall();
    act(() => panelStore.useStore.getState().setExpanded(true));
    tick(1000);
    act(() => fake.set({ on: true }));
    tick(1000); // on, then "Camera ready" (already ready) ...
    tick(1000); // ... then the settings step
    await throughTheVoiceSetup();
    expect(heading('Now you try')).toBeTruthy();
    act(() => fake.set({ sentence: 'Hello.' }));
    tick(1000);
    expect(heading('Ola speaks for you')).toBeTruthy();
    tick(8000); // no sound ever played (for example the sound is off)
    expect(screen.queryByRole('dialog')).toBeNull(); // it ends rather than waiting forever
    expect(localStorage.getItem('ola:tour')).toBe('done');
  });

  it('opens a guide with five sentences to try when the signing step starts, and keeps it after the tour ends', async () => {
    const { panelStore, fake } = mount();
    toTheCall();
    expect(screen.queryByRole('complementary', { name: 'Try these sentences' })).toBeNull();
    act(() => panelStore.useStore.getState().setExpanded(true));
    tick(1000);
    act(() => fake.set({ on: true }));
    tick(1000); // on, then "Camera ready" (already ready) ...
    tick(1000); // ... then the settings step
    expect(screen.queryByRole('complementary', { name: 'Try these sentences' })).toBeNull();
    await throughTheVoiceSetup();
    expect(heading('Now you try')).toBeTruthy();

    // The guide is open, with the five signs, and the popup itself stays light (no sign rows in it).
    const guide = screen.getByRole('complementary', { name: 'Try these sentences' });
    expect(guide.querySelectorAll('.sign-guide__pick li')).toHaveLength(5);
    expect(guide.textContent).toContain('“Hello, please wait.”');
    expect(
      screen.getByRole('dialog', { name: /Now you try/ }).querySelector('ol.tour-gestures'),
    ).toBeNull();

    // The tour carries on and ends; the guide is still there until it is closed.
    act(() => fake.set({ sentence: 'Hello, please wait.' }));
    tick(1000);
    act(() => fake.set({ speaking: true }));
    tick(100);
    act(() => fake.set({ speaking: false }));
    tick(1000);
    expect(screen.queryByRole('dialog', { name: /Ola speaks/ })).toBeNull();
    expect(localStorage.getItem('ola:tour')).toBe('done');
    expect(screen.getByRole('complementary', { name: 'Try these sentences' })).toBeTruthy();

    // It stays until the visitor closes it, and a small button brings it back.
    expect(screen.queryByRole('button', { name: 'Signs to try' })).toBeNull();
    press('Close the sign guide');
    expect(screen.queryByRole('complementary', { name: 'Try these sentences' })).toBeNull();
    press('Signs to try');
    expect(screen.getByRole('complementary', { name: 'Try these sentences' })).toBeTruthy();
  });

  it('offers the guide even to someone who skipped the tour, and never when disabled', () => {
    mount();
    press('Explore on my own');
    expect(screen.queryByRole('complementary', { name: 'Try these sentences' })).toBeNull();
    press('Signs to try');
    expect(screen.getByRole('complementary', { name: 'Try these sentences' })).toBeTruthy();
    cleanup();
    mount({ disabled: true });
    expect(screen.queryByRole('button', { name: 'Signs to try' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Try these sentences' })).toBeNull();
  });

  it('says what to do when the camera is blocked, instead of just waiting', () => {
    const { panelStore, fake } = mount();
    toTheCall();
    act(() => panelStore.useStore.getState().setExpanded(true));
    tick(1000);
    expect(heading('Turn Ola on')).toBeTruthy();
    act(() => fake.set({ problems: ['cameraBlocked'] }));
    // The title says what is wrong (not "Turn Ola on" / "Camera ready"), the line says what to do.
    expect(heading('Camera blocked')).toBeTruthy();
    expect(screen.getByText(/Allow while visiting the site.*Try again/)).toBeTruthy();
    act(() => fake.set({ problems: [], on: true }));
    expect(screen.queryByText(/Allow while visiting the site/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Camera blocked' })).toBeNull();
  });

  it('notices a camera stuck on Starting (a permission prompt) and says which choice works', () => {
    const { panelStore, fake } = mount();
    toTheCall();
    act(() => panelStore.useStore.getState().setExpanded(true));
    tick(1000);
    act(() => fake.set({ on: true, starting: true }));
    tick(1000);
    expect(heading('Camera ready')).toBeTruthy(); // starting for a moment is normal
    tick(SLOW_START_MS);
    expect(heading('Camera not starting')).toBeTruthy();
    expect(screen.getByText(/Allow while visiting the site.*Allow this time/)).toBeTruthy();
    act(() => fake.set({ starting: false }));
    expect(screen.queryByRole('heading', { name: 'Camera not starting' })).toBeNull();
  });

  it('skips a waiting step at once when the visitor has already done it', () => {
    const { panelStore } = mount();
    act(() => panelStore.useStore.getState().setExpanded(true));
    toTheCall();
    tick(1000);
    expect(heading('Turn Ola on')).toBeTruthy(); // the card was already open
  });

  it('leaves things as if done when a step is passed by, so the next step still makes sense', () => {
    mount();
    press('Start the tour');
    press('Skip step'); // add
    expect(getBrowser().installed).toBe(true);
    expect(heading('Pin Ola')).toBeTruthy();
    expect(screen.queryByText('Done.')).toBeNull(); // passing a step by is not "doing" it
    press('Skip step'); // pin
    expect(getBrowser()).toMatchObject({ pinned: true, menuOpen: false });
    expect(heading('Join the meeting')).toBeTruthy();
  });

  it('can always be moved past, and Done ends the tour with the window finished', () => {
    mount();
    toTheCall();
    skipToTheLastStep();
    expect(heading('Ola speaks for you')).toBeTruthy(); // playing with the signs is the last step
    press('Done');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('ola:tour')).toBe('done');
    expect(getBrowser()).toMatchObject({
      scene: 'call',
      installed: true,
      pinned: true,
      storeTab: false,
    });
  });

  it('closes with Escape or "Skip tour", remembered as skipped', () => {
    mount();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    localStorage.clear();
    document.body.innerHTML = '';
    resetBrowser();
    for (const id of ['scene-store', 'zoomer', 'zoom-anchor', 'browser']) {
      const el = document.createElement('div');
      el.id = id;
      document.body.append(el);
    }
    mount();
    toTheCall();
    press('Skip tour');
    expect(localStorage.getItem('ola:tour')).toBe('skipped');
  });
});

describe('the spotlight', () => {
  /** A stand-in for the highlighted control, with a size, so the spotlight has something to surround. */
  const control = () => {
    const el = document.createElement('button');
    el.getBoundingClientRect = () =>
      ({
        left: 400,
        top: 300,
        width: 60,
        height: 30,
        right: 460,
        bottom: 330,
        x: 400,
        y: 300,
        toJSON() {},
      }) as DOMRect;
    return el;
  };
  const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
  const noop = () => {};
  const step = (id: string) => COACH_STEPS.find((s) => s.id === id)!;
  /** No step only explains any more, but the Coach still supports one (for later): a step with nothing to wait for. */
  const explainOnly = {
    ...COACH_STEPS.find((s) => s.id === 'settings')!,
    waitFor: undefined,
    demo: undefined,
  };

  beforeEach(() => {
    vi.useRealTimers();
    for (const id of ['zoomer', 'zoom-anchor', 'browser']) {
      const el = document.createElement('div');
      el.id = id;
      document.body.append(el);
    }
  });

  it('blocks clicks on the highlighted thing when the step only explains (so nothing can open and cover it)', async () => {
    const { container } = render(
      <Coach
        step={explainOnly}
        index={6}
        total={9}
        find={control}
        done={false}
        onNext={noop}
        onSkip={noop}
      />,
    );
    await wait(60);
    // four around the lit area, and one over it
    expect(container.querySelectorAll('.tour-block')).toHaveLength(5);
  });

  it('on the install step shows the pointer but does not dim the page or block anything', async () => {
    const { container } = render(
      <Coach
        step={step('add')}
        index={0}
        total={9}
        find={control}
        done={false}
        onNext={noop}
        onSkip={noop}
      />,
    );
    await wait(60);
    expect(container.querySelector('.tour-pointer')).toBeTruthy();
    expect(container.querySelectorAll('.tour-block')).toHaveLength(0);
    expect(container.querySelector('.tour-ring')).toBeNull();
    expect(container.querySelector('.tour-dim')).toBeNull();
  });

  it('shows the pointer on the thing to click, and none on a step that only looks or explains', async () => {
    const onThing = render(
      <Coach
        step={step('on')}
        index={4}
        total={9}
        find={control}
        done={false}
        onNext={noop}
        onSkip={noop}
      />,
    );
    await wait(60);
    const pointer = onThing.container.querySelector<HTMLElement>('.tour-pointer')!;
    expect(pointer).toBeTruthy();
    expect(pointer.style.left).toBe('430px'); // the centre of the control (left 400, width 60)
    expect(pointer.style.top).toBe('315px');
    onThing.unmount();
    const settings = render(
      <Coach
        step={explainOnly}
        index={6}
        total={9}
        find={control}
        done={false}
        onNext={noop}
        onSkip={noop}
      />,
    );
    await wait(60);
    expect(settings.container.querySelector('.tour-pointer')).toBeNull();
  });

  it('never dims or blocks the page while the visitor is playing with the signs', async () => {
    for (const [id, index] of [
      ['sign', 7],
      ['speak', 8],
    ] as const) {
      const { container, unmount } = render(
        <Coach
          step={step(id)}
          index={index}
          total={9}
          find={control}
          done={false}
          onNext={noop}
          onSkip={noop}
        />,
      );
      await wait(60);
      expect(container.querySelectorAll('.tour-block')).toHaveLength(0);
      expect(container.querySelector('.tour-ring')).toBeNull();
      expect(container.querySelector('.tour-dim')).toBeNull();
      expect(container.querySelector('.tour-pop')).toBeTruthy(); // only the small popup is left
      unmount();
    }
  });

  it('lets clicks through to the highlighted thing when the step is waiting for one', async () => {
    const { container } = render(
      <Coach
        step={step('on')}
        index={4}
        total={9}
        find={control}
        done={false}
        onNext={noop}
        onSkip={noop}
      />,
    );
    await wait(60);
    expect(container.querySelectorAll('.tour-block')).toHaveLength(4);
  });

  it("draws one ring in the control's own shape, and does not move it with a slide", async () => {
    const { container } = render(
      <Coach
        step={step('on')}
        index={4}
        total={9}
        find={control}
        done={false}
        onNext={noop}
        onSkip={noop}
      />,
    );
    await wait(60);
    const ring = container.querySelector<HTMLElement>('.tour-ring')!;
    expect(ring).toBeTruthy();
    expect(ring.style.left).toBe('394px'); // 6 px around the control
    expect(ring.style.width).toBe('72px');
  });

  it('aims the zoom once, however often the widget redraws the same control', async () => {
    const aim = vi.mocked(zoomModule.applyZoom);
    aim.mockClear();
    let looked = 0;
    // A NEW element every time, as when the widget redraws itself.
    const find = () => {
      looked++;
      return control();
    };
    render(
      <Coach
        step={step('on')}
        index={4}
        total={9}
        find={find}
        done={false}
        onNext={noop}
        onSkip={noop}
      />,
    );
    await wait(900);
    expect(looked).toBeGreaterThan(5);
    expect(aim.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(aim.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('keeps the zoom gentle: nothing zooms past 2x and no step pulls back first', () => {
    for (const s of COACH_STEPS) {
      expect(s.zoom).toBeLessThanOrEqual(2);
      expect('pullBack' in s).toBe(false);
    }
  });
});

describe('the sign guide', () => {
  it('has five meaningful sentences, each made of signs the model knows, each sign with its motion', () => {
    expect(PRACTICE_SENTENCES.map((p) => p.says)).toEqual([
      'Hello, please wait.',
      'Yes, please.',
      'No, thank you.',
      "I'm fine, thank you.",
      'Thank you, goodbye.',
    ]);
    for (const { says, signs } of PRACTICE_SENTENCES) {
      expect(says.length).toBeGreaterThan(5);
      expect(signs.length).toBeGreaterThanOrEqual(2);
      expect(signs.length).toBeLessThanOrEqual(3);
      for (const sign of signs) {
        expect(SIGNS).toContain(sign);
        expect(SIGN_MOTION[sign]).toBeTruthy();
        expect(SIGN_INFO[sign as keyof typeof SIGN_INFO].hint.length).toBeGreaterThan(10);
      }
    }
    expect(Object.keys(SIGN_MOTION).sort()).toEqual([...PRACTICE_SIGNS].sort());
    // HELLO and PLEASE are both a flat hand: the place and the movement are what tell them apart.
    expect(SIGN_INFO.hello.shape).toEqual(SIGN_INFO.please.shape);
    expect(SIGN_INFO.hello.place).not.toBe(SIGN_INFO.please.place);
    expect(SIGN_MOTION.hello).not.toBe(SIGN_MOTION.please);
  });

  it('shows how to make each sign of a sentence: a hand shape, a place, an arrow, the movement in words, and a moving hand', () => {
    render(<GestureList signs={PRACTICE_SENTENCES[0]!.signs} label="Signs to try" />);
    const rows = [...screen.getByRole('list', { name: 'Signs to try' }).querySelectorAll('li')];
    expect(rows.map((r) => r.querySelector('strong')?.textContent?.toLowerCase())).toEqual([
      'hello',
      'please',
      'wait',
    ]);
    rows.forEach((row, i) => {
      const sign = PRACTICE_SENTENCES[0]!.signs[i]! as keyof typeof SIGN_INFO;
      expect(row.querySelectorAll('svg')).toHaveLength(3);
      expect(row.textContent).toContain(SIGN_INFO[sign].hint);
      expect(row.querySelector('.tour-gestures__art')!.className).toContain(
        `tour-gestures__art--${SIGN_MOTION[sign]}`,
      );
    });
  });

  it('shows one sentence at a time with its signs in order, and the numbers switch between them', () => {
    render(<SignGuide open onClose={() => {}} />);
    const picks = screen.getAllByRole('button', { name: /^Sentence \d/ });
    expect(picks).toHaveLength(5);
    expect(picks[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('“Hello, please wait.”')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Signs for: Hello, please wait.' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sentence 3: No, thank you.' }));
    expect(screen.getByText('“No, thank you.”')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Signs for: No, thank you.' });
    expect([...list.querySelectorAll('strong')].map((s) => s.textContent?.toLowerCase())).toEqual([
      'no',
      'thank you',
    ]);
    expect(screen.queryByText('“Hello, please wait.”')).toBeNull();
    expect(list.textContent).toContain('tap down onto your thumb');
  });

  it('closes with its button or Escape, and renders nothing when closed', () => {
    const close = vi.fn();
    const { rerender } = render(<SignGuide open onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close the sign guide' }));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('complementary', { name: 'Try these sentences' }), {
      key: 'Escape',
    });
    expect(close).toHaveBeenCalledTimes(2);
    rerender(<SignGuide open={false} onClose={close} />);
    expect(screen.queryByRole('complementary', { name: 'Try these sentences' })).toBeNull();
  });
});

describe('gliding between steps', () => {
  it('eases from 0 to 1, slowing down at the end', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(-1)).toBe(0);
  });

  it('starts where it was, ends where it is going, and is in between along the way', () => {
    const from = { left: 100, top: 100, width: 50, height: 20 };
    const to = { left: 500, top: 300, width: 90, height: 60, borderRadius: '12px' };
    expect(glideFrame(from, to, 0)).toEqual({ ...to, ...from });
    expect(glideFrame(from, to, 1)).toBe(to);
    const mid = glideFrame(from, to, 0.4);
    expect(mid.left).toBeGreaterThan(100);
    expect(mid.left).toBeLessThan(500);
    expect(mid.borderRadius).toBe('12px');
    expect(glideFrame(null, to, 0.2)).toBe(to); // nothing to glide from: it just appears
    expect(glideSpot({ left: 0, top: 0 }, { left: 100, top: 40 }, 1)).toEqual({
      left: 100,
      top: 40,
    });
    expect(glideSpot(null, { left: 5, top: 6 }, 0.1)).toEqual({ left: 5, top: 6 });
  });
});

describe('the ring between steps', () => {
  const box = (left: number, top: number) => () => {
    const el = document.createElement('button');
    el.getBoundingClientRect = () =>
      ({
        left,
        top,
        width: 60,
        height: 30,
        right: left + 60,
        bottom: top + 30,
        x: left,
        y: top,
        toJSON() {},
      }) as DOMRect;
    return el;
  };
  const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
  const noop = () => {};
  const stepOf = (id: string) => COACH_STEPS.find((s) => s.id === id)!;

  beforeEach(() => {
    vi.useRealTimers();
    for (const id of ['zoomer', 'zoom-anchor', 'browser']) {
      const el = document.createElement('div');
      el.id = id;
      document.body.append(el);
    }
  });

  it('glides to the next target instead of jumping, and the same ring stays on screen (so the dimming never blinks)', async () => {
    const props = { index: 4, total: 9, done: false, onNext: noop, onSkip: noop };
    const { container, rerender } = render(
      <Coach {...props} step={stepOf('on')} find={box(200, 200)} />,
    );
    await wait(80);
    const ring = container.querySelector<HTMLElement>('.tour-ring')!;
    expect(ring.style.left).toBe('194px');

    // The next step points somewhere far away.
    rerender(<Coach {...props} step={stepOf('settings')} find={box(900, 600)} />);
    await wait(60);
    const early = parseFloat(container.querySelector<HTMLElement>('.tour-ring')!.style.left);
    expect(early).toBeGreaterThan(194); // on its way
    expect(early).toBeLessThan(894); // not there yet
    expect(container.querySelector('.tour-ring')).toBe(ring); // the very same element: no remount, no blink

    await wait(GLIDE_MS + 150);
    expect(container.querySelector<HTMLElement>('.tour-ring')!.style.left).toBe('894px');
  });
});

describe('revealInScroller', () => {
  const rect = (top: number, height: number) =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: top,
    }) as DOMRect;

  /** A scrolling panel inside a shadow root, 600 px tall and drawn at `zoom`, holding a 60 px button at `buttonTop`. */
  function setup(buttonTop: number, zoom = 1) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const panel = document.createElement('div');
    panel.style.overflowY = 'auto';
    const button = document.createElement('button');
    panel.appendChild(button);
    root.appendChild(panel);
    Object.defineProperty(panel, 'clientHeight', { value: 600 });
    Object.defineProperty(panel, 'scrollHeight', { value: 1800 });
    panel.getBoundingClientRect = () => rect(100, 600 * zoom);
    button.getBoundingClientRect = () => rect(buttonTop, 60 * zoom);
    return { host, panel, button };
  }

  it('scrolls only the panel so a target above the fold lands in its middle', () => {
    const { host, panel, button } = setup(-1000);
    panel.scrollTop = 1200;
    revealInScroller(button);
    // target top -1000, panel top 100, centre offset (600 - 60) / 2 = 270: 1200 + (-1000 - 100 - 270)
    expect(panel.scrollTop).toBe(1200 - 1370);
    host.remove();
  });

  it('leaves a target that is already in view alone, and allows for the zoom', () => {
    const inView = setup(300);
    inView.panel.scrollTop = 50;
    revealInScroller(inView.button);
    expect(inView.panel.scrollTop).toBe(50);
    inView.host.remove();
    const zoomed = setup(1400, 2); // drawn at 2x: a 1000 px offset on screen is 500 px of scrolling
    zoomed.panel.scrollTop = 0;
    revealInScroller(zoomed.button);
    expect(zoomed.panel.scrollTop).toBe((1400 - 100 - (1200 - 120) / 2) / 2);
    zoomed.host.remove();
  });
});
