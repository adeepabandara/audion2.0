import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as settingsModule from '../lib/settings';
import { createSettingsStore } from '../lib/settings';
import { memoryStore } from '../lib/storage';
import { AudionApp } from './AudionApp';
import { AudionSession, type SessionDeps } from './session';
import { createPanelStore } from './store';

vi.mock('../lib/messages', async (orig) => ({ ...(await orig<object>()), send: vi.fn() }));

function fakeSession(overrides: Partial<SessionDeps> = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const deps: SessionDeps = {
    tracker: { start: async () => {}, detect: async () => null, stop: vi.fn() },
    getCamera: async () => stream,
    createRecorder: () => ({ arm() {}, disarm() {}, signStarted() {}, finish: async () => null }),
    send: async () => ({ ok: true, mode: 'mock', confidenceThreshold: 0.5 }),
    settings: () => ({ holdTimeMs: 400, pauseMs: 1500 }),
    luminance: () => 120,
    now: () => 0,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    ...overrides,
  };
  return { session: new AudionSession(deps), track };
}

let host: HTMLElement;
let root: Root;

/** Mounts the app exactly like the content script does: React inside a Shadow root. */
async function mount(session = fakeSession().session) {
  const settings = createSettingsStore(memoryStore());
  vi.spyOn(settingsModule, 'getSettingsStore').mockReturnValue(settings);
  const prefs = memoryStore();
  const panelStore = createPanelStore(prefs);

  host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  shadow.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <AudionApp
        session={session}
        portalContainer={container}
        alwaysShow
        panelStore={panelStore}
      />,
    );
  });
  await waitFor(() =>
    expect(within(container).getByRole('group', { name: 'Audion' })).toBeTruthy(),
  );
  return { ui: within(container), container, shadow, settings, prefs, panelStore, session };
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('Audion in a Shadow root', () => {
  it('renders only inside the shadow root, leaving the host page untouched', async () => {
    const { shadow } = await mount();
    expect(shadow.querySelector('.ap-pill')).toBeTruthy();
    expect(document.body.querySelector('.ap-pill')).toBeNull();
    expect(document.body.getAttribute('aria-hidden')).toBeNull();
  });

  it('starts as a collapsed pill: Off, with icon + text status', async () => {
    const { ui } = await mount();
    expect(ui.getByRole('status').textContent).toBe('Off');
    expect(ui.getByRole('switch', { name: 'Audion' }).getAttribute('aria-checked')).toBe('false');
  });

  it('toggling On updates the status; expanding and collapsing is remembered', async () => {
    const { ui, prefs } = await mount();
    fireEvent.click(ui.getByRole('switch', { name: 'Audion' }));
    await waitFor(() => expect(ui.getByRole('status').textContent).toBe('Ready'));

    fireEvent.click(ui.getByRole('button', { name: 'Expand Audion' }));
    expect(ui.getByRole('region', { name: 'Audion panel' })).toBeTruthy();
    expect(await prefs.get('panelPrefs')).toMatchObject({ expanded: true });

    fireEvent.click(ui.getByRole('button', { name: 'Collapse Audion' }));
    expect(ui.getByRole('group', { name: 'Audion' })).toBeTruthy();
    expect(await prefs.get('panelPrefs')).toMatchObject({ expanded: false });
  });

  it('restores expanded state and dragged position on the next load', async () => {
    const prefs = memoryStore({
      panelPrefs: { expanded: true, position: { right: 200, bottom: 300 } },
    });
    const panelStore = createPanelStore(prefs);
    vi.spyOn(settingsModule, 'getSettingsStore').mockReturnValue(
      createSettingsStore(memoryStore()),
    );
    host = document.createElement('div');
    document.body.append(host);
    const container = document.createElement('div');
    host.attachShadow({ mode: 'open' }).append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <AudionApp
          session={fakeSession().session}
          portalContainer={container}
          alwaysShow
          panelStore={panelStore}
        />,
      ),
    );
    const card = await within(container).findByRole('region', { name: 'Audion panel' });
    expect(card.style.right).toBe('200px');
    expect(card.style.bottom).toBe('300px');
  });

  it('moves with the keyboard, saves the position, and never goes below the control bar', async () => {
    const { ui, prefs } = await mount();
    fireEvent.click(ui.getByRole('button', { name: 'Expand Audion' }));
    const card = ui.getByRole('region', { name: 'Audion panel' });
    const grip = ui.getByRole('button', { name: /Move Audion panel/ });
    const bottom0 = parseInt(card.style.bottom);
    expect(bottom0).toBeGreaterThanOrEqual(96); // default clearance above the (unfound) bar

    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(parseInt(card.style.bottom)).toBe(bottom0 + 16);
    fireEvent.keyDown(grip, { key: 'ArrowLeft', shiftKey: true });
    expect(parseInt(card.style.right)).toBe(16 + 64);
    expect(await prefs.get('panelPrefs')).toMatchObject({ position: { right: 80 } });

    for (let i = 0; i < 40; i++) fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(parseInt(card.style.bottom)).toBe(bottom0); // clamped at the clearance
  });

  it('opens the settings drawer inside the shadow root and saves changes', async () => {
    const { ui, settings, shadow } = await mount();
    fireEvent.click(ui.getByRole('button', { name: 'Expand Audion' }));
    fireEvent.click(ui.getByRole('button', { name: 'Settings' }));
    const drawer = await ui.findByRole('dialog', { name: 'Settings' });
    expect(shadow.contains(drawer)).toBe(true);

    fireEvent.click(within(drawer).getByRole('radio', { name: 'Confirm first' }));
    await waitFor(() => expect(settings.useStore.getState().settings.speakMode).toBe('confirm'));

    fireEvent.click(within(drawer).getByRole('switch', { name: /post sentences to Meet chat/ }));
    await waitFor(() => expect(settings.useStore.getState().settings.postToChat).toBe(true));

    // Privacy toggle is on and locked; other languages are shown as coming soon.
    const privacy = within(drawer).getByRole('switch', { name: 'Don’t store any video' });
    expect(privacy.getAttribute('aria-checked')).toBe('true');
    expect((privacy as HTMLButtonElement).disabled).toBe(true);
    expect(within(drawer).getAllByText('Coming soon').length).toBeGreaterThan(0);
    expect(within(drawer).getByText(/PopSign ASL v1.0 \(CC BY 4.0\)/)).toBeTruthy();
    expect(within(drawer).getByText(/can’t see Audion’s own caption bar/)).toBeTruthy();
  });

  it('keeps the drawer open when clicking inside it and closes on Escape', async () => {
    const { ui } = await mount();
    fireEvent.click(ui.getByRole('button', { name: 'Expand Audion' }));
    fireEvent.click(ui.getByRole('button', { name: 'Settings' }));
    const drawer = await ui.findByRole('dialog', { name: 'Settings' });

    const target = within(drawer).getByText('Voice and speed');
    fireEvent.pointerDown(target);
    fireEvent.mouseDown(target);
    fireEvent.click(target);
    expect(ui.queryByRole('dialog', { name: 'Settings' })).toBeTruthy();

    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(ui.queryByRole('dialog', { name: 'Settings' })).toBeNull());
  });

  it('shows all 22 supported signs from the panel footer and from settings', async () => {
    const { ui } = await mount();
    fireEvent.click(ui.getByRole('button', { name: 'Expand Audion' }));
    fireEvent.click(ui.getByRole('button', { name: 'Supported signs' }));
    const sheet = await ui.findByRole('dialog', { name: 'Supported signs' });
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(22);
    expect(within(sheet).getByText('thank you')).toBeTruthy();
    expect(within(sheet).getByText(/The list will grow/)).toBeTruthy();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(ui.queryByRole('dialog')).toBeNull());

    fireEvent.click(ui.getByRole('button', { name: 'Settings' }));
    const settingsDrawer = await ui.findByRole('dialog', { name: 'Settings' });
    fireEvent.click(within(settingsDrawer).getByRole('button', { name: 'See supported signs' }));
    expect(await ui.findByRole('dialog', { name: 'Supported signs' })).toBeTruthy();
  });

  it('applies the chosen theme to the whole surface', async () => {
    const { ui, settings, container } = await mount();
    await act(async () => settings.useStore.getState().update({ theme: 'light' }));
    expect(container.querySelector('.ap-layer')?.getAttribute('data-theme')).toBe('light');
    expect(ui.getByRole('group', { name: 'Audion' })).toBeTruthy();
  });
});

describe('recognition UI', () => {
  const recognised = (sign: 'hello' | 'tomorrow', confidence: number | null) =>
    ({ type: 'RECOGNISED', sign, confidence, threshold: 0.5 }) as const;

  async function on(session = fakeSession().session) {
    const app = await mount(session);
    fireEvent.click(app.ui.getByRole('button', { name: 'Expand Audion' }));
    fireEvent.click(app.ui.getByRole('switch', { name: 'Audion' }));
    await waitFor(() => expect(app.ui.getByRole('status').textContent).toBe('Ready'));
    return app;
  }

  it('turning On starts the camera and Off releases it', async () => {
    const { session, track } = fakeSession();
    const { ui } = await on(session);
    expect(session.getState().on).toBe(true);
    fireEvent.click(ui.getByRole('switch', { name: 'Audion' }));
    expect(track.stop).toHaveBeenCalled();
    expect(ui.getByRole('status').textContent).toBe('Off');
  });

  it('shows recognised signs as chips: normal ones as confirmed, low-confidence ones with a question mark', async () => {
    const { session } = fakeSession();
    const { ui } = await on(session);
    await act(async () => {
      session.dispatch({ type: 'CLIP_READY' });
      session.dispatch(recognised('hello', 0.9));
      session.dispatch({ type: 'CLIP_READY' });
      session.dispatch(recognised('tomorrow', 0.3));
    });
    const row = ui.getByRole('group', { name: 'Recognised signs' });
    expect(within(row).getByText('hello')).toBeTruthy();
    expect(within(row).getByText(/low confidence/)).toBeTruthy();
  });

  it('asks "Did you mean …?" for a low-confidence sign; Yes confirms it', async () => {
    const { session } = fakeSession();
    const { ui } = await on(session);
    await act(async () => {
      session.dispatch({ type: 'CLIP_READY' });
      session.dispatch(recognised('tomorrow', 0.3));
    });
    const dialog = await ui.findByRole('dialog', { name: 'Did you mean “tomorrow”?' });
    expect(within(dialog).getByText('Enter')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Yes/ }));
    await waitFor(() => expect(ui.queryByRole('dialog')).toBeNull());
    expect(session.getState().chips[0]?.state).toBe('confirmed');
  });

  it('Try again, and Esc, remove the unsure sign', async () => {
    for (const how of ['button', 'escape'] as const) {
      const { session } = fakeSession();
      const { ui } = await on(session);
      await act(async () => {
        session.dispatch({ type: 'CLIP_READY' });
        session.dispatch(recognised('tomorrow', 0.3));
      });
      const dialog = await ui.findByRole('dialog', { name: 'Did you mean “tomorrow”?' });
      if (how === 'button')
        fireEvent.click(within(dialog).getByRole('button', { name: /Try again/ }));
      else fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(session.getState().chips).toEqual([]));
      await act(async () => root.unmount());
      host.remove();
    }
    // afterEach unmounts again; give it a mounted tree to unmount.
    root = createRoot(document.createElement('div'));
    host = document.createElement('div');
  });

  it('expands the pill by itself when a sign needs confirming', async () => {
    const { session } = fakeSession();
    const { ui, panelStore } = await mount(session);
    await act(async () => {
      session.dispatch({ type: 'TURN_ON' });
      session.dispatch({ type: 'CAMERA_READY' });
      session.dispatch({ type: 'CLIP_READY' });
      session.dispatch(recognised('tomorrow', 0.3));
    });
    await waitFor(() => expect(panelStore.useStore.getState().expanded).toBe(true));
    expect(await ui.findByRole('dialog', { name: /Did you mean/ })).toBeTruthy();
  });

  it('shows each problem with an icon, a label and guidance', async () => {
    const cases: Array<
      [Parameters<ReturnType<typeof fakeSession>['session']['dispatch']>[0], string, RegExp]
    > = [
      [{ type: 'LIGHT', dark: true }, 'Poor lighting', /Move to a brighter spot/],
      [{ type: 'ONLINE', online: false }, 'Reconnecting…', /saved and will be sent/],
      [
        { type: 'CLIP_DISCARDED', reason: 'tooShort' },
        'Couldn’t recognize that',
        /try again slowly/,
      ],
      [{ type: 'HANDS_EDGE', out: true }, 'Hands out of frame', /inside the outline/],
    ];
    for (const [event, label, hint] of cases) {
      const { session } = fakeSession();
      const { ui, container } = await on(session);
      await act(async () => session.dispatch(event));
      expect(container.querySelector('.au-pill')?.textContent).toBe(label);
      expect(ui.getByText(hint)).toBeTruthy();
      expect(container.querySelector('.au-banner .au-icon')).toBeTruthy(); // never colour alone
      await act(async () => root.unmount());
      host.remove();
      root = createRoot(document.createElement('div'));
      host = document.createElement('div');
    }
  });

  it('camera blocked: explains, offers Fix permissions steps and Try again', async () => {
    const getCamera = vi
      .fn<() => Promise<MediaStream>>()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const { session, track } = fakeSession({ getCamera });
    getCamera.mockResolvedValueOnce({ getTracks: () => [track] } as unknown as MediaStream);
    const { ui } = await mount(session);
    fireEvent.click(ui.getByRole('switch', { name: 'Audion' }));
    expect(await ui.findByText(/Chrome is blocking the camera/)).toBeTruthy(); // pill auto-expanded

    fireEvent.click(ui.getByRole('button', { name: 'Fix permissions' }));
    expect(ui.getByText(/camera icon at the right end/)).toBeTruthy();
    expect(ui.getByRole('button', { name: 'Open Chrome camera settings' })).toBeTruthy();

    fireEvent.click(ui.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(session.getState().on).toBe(true));
    expect(getCamera).toHaveBeenCalledTimes(2);
  });
});
