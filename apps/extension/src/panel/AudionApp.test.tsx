import { SIGN_LIST } from './signs';
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as settingsModule from '../lib/settings';
import { createSettingsStore } from '../lib/settings';
import { memoryStore } from '../lib/storage';
import { send } from '../lib/messages';
import { AudionApp } from './AudionApp';
import { fakeSession } from '../testing/fakeSession';
import { createPanelStore } from './store';

vi.mock('../lib/messages', async (orig) => ({ ...(await orig<object>()), send: vi.fn() }));

let host: HTMLElement;
let root: Root;

/** Mounts the app exactly like the content script does: React inside a Shadow root. */
async function mount(session = fakeSession().session, extra: { bounds?: HTMLElement } = {}) {
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
        {...extra}
      />,
    );
  });
  await waitFor(() => expect(within(container).getByRole('group', { name: 'Ola' })).toBeTruthy());
  return { ui: within(container), container, shadow, settings, prefs, panelStore, session };
}

beforeEach(() => {
  vi.mocked(send).mockReset();
  vi.mocked(send).mockResolvedValue({ ok: true, entries: [] } as never);
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
    expect(ui.getByRole('switch', { name: 'Ola' }).getAttribute('aria-checked')).toBe('false');
  });

  it('toggling On updates the status; expanding and collapsing is remembered', async () => {
    const { ui, prefs } = await mount();
    fireEvent.click(ui.getByRole('switch', { name: 'Ola' }));
    await waitFor(() => expect(ui.getByRole('status').textContent).toBe('Ready'));

    fireEvent.click(ui.getByRole('button', { name: 'Expand Ola' }));
    expect(ui.getByRole('region', { name: 'Ola panel' })).toBeTruthy();
    expect(await prefs.get('panelPrefs')).toMatchObject({ expanded: true });

    fireEvent.click(ui.getByRole('button', { name: 'Collapse Ola' }));
    expect(ui.getByRole('group', { name: 'Ola' })).toBeTruthy();
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
    const card = await within(container).findByRole('region', { name: 'Ola panel' });
    expect(card.style.right).toBe('200px');
    expect(card.style.bottom).toBe('300px');
  });

  it('moves with the keyboard, saves the position, and never goes below the control bar', async () => {
    const { ui, prefs } = await mount();
    fireEvent.click(ui.getByRole('button', { name: 'Expand Ola' }));
    const card = ui.getByRole('region', { name: 'Ola panel' });
    const grip = ui.getByRole('button', { name: /Move Ola panel/ });
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

  it('picks a language for live translation from the card and saves it', async () => {
    const { ui, settings } = await mount();
    fireEvent.click(ui.getByRole('button', { name: 'Expand Ola' }));
    const picker = ui.getByRole('button', { name: /Translate Ola.*English/ });
    expect(picker.getAttribute('aria-haspopup')).toBe('listbox');
    fireEvent.click(picker);
    const list = await ui.findByRole('listbox', { name: /Translate Ola/ });
    expect(within(list).getAllByRole('option')).toHaveLength(9);
    fireEvent.click(within(list).getByRole('option', { name: /Español/ }));
    await waitFor(() => expect(settings.useStore.getState().settings.language).toBe('es'));
    expect(ui.queryByRole('listbox')).toBeNull();
    expect(ui.getByRole('button', { name: /Translate Ola.*Español/ })).toBeTruthy();
    expect(ui.queryByText(/Translating to/)).toBeNull(); // no ribbon: the picker itself shows the language
  });

  it('opens the settings drawer inside the shadow root and saves changes', async () => {
    const { ui, settings, shadow } = await mount();
    fireEvent.click(ui.getByRole('button', { name: 'Expand Ola' }));
    fireEvent.click(ui.getByRole('button', { name: 'Settings' }));
    const drawer = await ui.findByRole('dialog', { name: 'Settings' });
    expect(shadow.contains(drawer)).toBe(true);

    fireEvent.click(within(drawer).getByRole('radio', { name: 'Confirm first' }));
    await waitFor(() => expect(settings.useStore.getState().settings.speakMode).toBe('confirm'));

    // Hearing Ola's voice on this device is on by default and can be switched off.
    expect(settings.useStore.getState().settings.monitorVoice).toBe(true);
    fireEvent.click(
      within(drawer).getByRole('switch', { name: 'Hear Ola’s voice on this device' }),
    );
    await waitFor(() => expect(settings.useStore.getState().settings.monitorVoice).toBe(false));

    fireEvent.click(within(drawer).getByRole('tab', { name: 'Display' }));
    fireEvent.click(
      await within(drawer).findByRole('switch', { name: /post sentences to Meet chat/ }),
    );
    await waitFor(() => expect(settings.useStore.getState().settings.postToChat).toBe(true));
    expect(within(drawer).getByText(/can’t see Ola’s caption bar/)).toBeTruthy();

    // Privacy toggle is on and locked.
    fireEvent.click(within(drawer).getByRole('tab', { name: 'About' }));
    const privacy = within(drawer).getByRole('switch', { name: 'Don’t store any video' });
    expect(privacy.getAttribute('aria-checked')).toBe('true');
    expect((privacy as HTMLButtonElement).disabled).toBe(true);
    expect(within(drawer).getByText(/PopSign ASL v1.0 \(CC BY 4.0\)/)).toBeTruthy();
    expect(within(drawer).getByText(/not known yet/)).toBeTruthy(); // no model reported yet
  });

  it('says whether the call can hear Ola, and why not', async () => {
    const env = fakeSession();
    const { ui } = await mount(env.session);
    fireEvent.click(ui.getByRole('switch', { name: 'Ola' }));
    fireEvent.click(await ui.findByRole('button', { name: 'Expand Ola' }));
    expect(await ui.findByText(/Call audio connected/)).toBeTruthy();

    await act(async () => env.voice.emitChannel({ hasChannel: false, micMuted: false }));
    expect(await ui.findByText(/Not in the call yet/)).toBeTruthy();
    expect(ui.queryByText(/Call audio connected/)).toBeNull();
  });

  it('tells the signer whether the last sentence reached the call', async () => {
    const env = fakeSession();
    const { ui } = await mount(env.session);
    fireEvent.click(ui.getByRole('switch', { name: 'Ola' }));
    fireEvent.click(await ui.findByRole('button', { name: 'Expand Ola' }));
    expect(await ui.findByText(/Call audio connected/)).toBeTruthy();

    await act(async () => env.voice.emitDelivery(true));
    expect(await ui.findByText(/Call audio connected · sent/)).toBeTruthy();

    await act(async () => env.voice.emitDelivery(false));
    expect(await ui.findByText(/Call can’t hear Ola/)).toBeTruthy();
    expect(ui.queryByText(/Call audio connected · sent/)).toBeNull();
  });

  it('shows which recognition model is answering under About', async () => {
    const { ui, session } = await mount();
    await act(async () => session.dispatch({ type: 'MODEL_ID', modelId: 'tuned:1234567890' }));
    fireEvent.click(ui.getByRole('button', { name: 'Expand Ola' }));
    fireEvent.click(ui.getByRole('button', { name: 'Settings' }));
    const drawer = await ui.findByRole('dialog', { name: 'Settings' });
    fireEvent.click(within(drawer).getByRole('tab', { name: 'About' }));
    expect(await within(drawer).findByText('tuned:1234567890')).toBeTruthy();
  });

  it('keeps the drawer open when clicking inside it and closes on Escape', async () => {
    const { ui } = await mount();
    fireEvent.click(ui.getByRole('button', { name: 'Expand Ola' }));
    fireEvent.click(ui.getByRole('button', { name: 'Settings' }));
    const drawer = await ui.findByRole('dialog', { name: 'Settings' });

    const target = within(drawer).getByText('My voice');
    fireEvent.pointerDown(target);
    fireEvent.mouseDown(target);
    fireEvent.click(target);
    expect(ui.queryByRole('dialog', { name: 'Settings' })).toBeTruthy();

    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(ui.queryByRole('dialog', { name: 'Settings' })).toBeNull());
  });

  it('shows every supported sign inside Settings, and no longer in the footer', async () => {
    const { ui } = await mount();
    fireEvent.click(ui.getByRole('button', { name: 'Expand Ola' }));
    expect(ui.queryByRole('button', { name: 'Supported signs' })).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: 'Settings' }));
    const drawer = await ui.findByRole('dialog', { name: 'Settings' });
    fireEvent.click(within(drawer).getByRole('tab', { name: 'Signs' }));
    const panel = await within(drawer).findByRole('tabpanel');
    expect(within(panel).getAllByRole('listitem')).toHaveLength(SIGN_LIST.length);
    expect(within(panel).getByText('thank you')).toBeTruthy();
    expect(within(panel).getByText(/The list will grow/)).toBeTruthy();
  });

  it('moves between the settings tabs with the arrow keys', async () => {
    const { ui } = await mount();
    fireEvent.click(ui.getByRole('button', { name: 'Expand Ola' }));
    fireEvent.click(ui.getByRole('button', { name: 'Settings' }));
    const drawer = await ui.findByRole('dialog', { name: 'Settings' });
    const voice = within(drawer).getByRole('tab', { name: 'Voice' });
    expect(voice.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(voice, { key: 'ArrowRight' });
    const signing = within(drawer).getByRole('tab', { name: 'Signing' });
    expect(signing.getAttribute('aria-selected')).toBe('true');
    expect(within(drawer).getByRole('tabpanel').textContent).toMatch(/Sentence pause/);
  });

  it('applies the chosen theme to the whole surface', async () => {
    const { ui, settings, container } = await mount();
    await act(async () => settings.useStore.getState().update({ theme: 'light' }));
    expect(container.querySelector('.ap-layer')?.getAttribute('data-theme')).toBe('light');
    expect(ui.getByRole('group', { name: 'Ola' })).toBeTruthy();
  });
});

describe('recognition UI', () => {
  const recognised = (sign: 'hello' | 'tomorrow', confidence: number | null) =>
    ({ type: 'RECOGNISED', sign, confidence, threshold: 0.5 }) as const;

  async function on(session = fakeSession().session) {
    const app = await mount(session);
    fireEvent.click(app.ui.getByRole('button', { name: 'Expand Ola' }));
    fireEvent.click(app.ui.getByRole('switch', { name: 'Ola' }));
    await waitFor(() => expect(app.ui.getByRole('status').textContent).toBe('Ready'));
    return app;
  }

  it('turning On starts the camera and Off releases it', async () => {
    const { session, track } = fakeSession();
    const { ui } = await on(session);
    expect(session.getState().on).toBe(true);
    fireEvent.click(ui.getByRole('switch', { name: 'Ola' }));
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

  it('shows a red dot instead of repeating "Off" in the collapsed pill, and the status once Ola is on', async () => {
    const { session } = fakeSession();
    const { ui, shadow } = await mount(session);
    const pill = () => shadow.querySelector('.ap-pill');
    expect(pill()?.classList.contains('ap-pill--off')).toBe(true);
    expect(pill()?.querySelector('.ap-pill__dot')).toBeTruthy();
    // the toggle still says Off in words; the status stays available to screen readers
    expect(ui.getByRole('status').textContent).toBe('Off');
    fireEvent.click(ui.getByRole('switch', { name: 'Ola' }));
    await waitFor(() => expect(ui.getByRole('status').textContent).toBe('Ready'));
    expect(pill()?.classList.contains('ap-pill--off')).toBe(false);
  });

  it('keeps the card inside the element it is given (web demo call window), not the whole browser window', async () => {
    const bounds = document.createElement('div');
    Object.defineProperty(bounds, 'clientWidth', { value: 700 });
    Object.defineProperty(bounds, 'clientHeight', { value: 400 });
    const { session } = fakeSession();
    const { ui, shadow } = await mount(session, { bounds });
    fireEvent.click(ui.getByRole('button', { name: 'Expand Ola' }));
    const card = await waitFor(() => {
      const el = shadow.querySelector<HTMLElement>('.ap-card');
      expect(el).toBeTruthy();
      return el!;
    });
    // 400 px high window - 96 px of control bar clearance - 8 px margin; the window here is 900 px high.
    expect(card.style.maxHeight).toBe('296px');
  });

  it('tells the signer to keep signing while signs wait for a sentence, then stops', async () => {
    const { session } = fakeSession();
    const { ui } = await on(session);
    expect(ui.queryByText(/Keep signing to build a sentence/)).toBeNull();
    await act(async () => {
      session.dispatch({ type: 'CLIP_READY' });
      session.dispatch(recognised('hello', 0.9));
    });
    expect(ui.getByText(/Keep signing to build a sentence/)).toBeTruthy();
    await act(async () => {
      session.dispatch({ type: 'COMPOSE_START' });
    });
    expect(ui.queryByText(/Keep signing to build a sentence/)).toBeNull();
  });

  it('meeting context is opt-in: off by default, with a plain note about the captions', async () => {
    const { session } = fakeSession();
    const { ui, settings } = await on(session);
    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Settings/i }));
    });
    await act(async () => {
      fireEvent.click(await ui.findByRole('tab', { name: 'Signing' }));
    });
    const toggle = await ui.findByRole('switch', { name: 'Use the meeting to word sentences' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(ui.getByText(/never stored/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(settings.useStore.getState().settings.meetingContext).toBe(true);
  });

  it('tells the session to follow the meeting only while the setting and Ola are both on', async () => {
    const { session } = fakeSession();
    const follow = vi.spyOn(session, 'setMeetingContext');
    const { ui, settings } = await on(session);
    expect(follow).toHaveBeenLastCalledWith(false); // Ola is on but the setting is off
    await act(async () => settings.useStore.getState().update({ meetingContext: true }));
    expect(follow).toHaveBeenLastCalledWith(true);
    fireEvent.click(ui.getByRole('switch', { name: 'Ola' })); // Ola off
    expect(follow).toHaveBeenLastCalledWith(false);
  });

  it('shows the meeting context as an icon only, on the sentence card’s top-right corner', async () => {
    const { session } = fakeSession();
    const { shadow } = await on(session);
    const wrap = shadow.querySelector('.ap-sentence-wrap') as HTMLElement;
    const badge = wrap.querySelector('.ap-ctx') as HTMLElement;
    // the badge is inside the sentence card's wrapper, next to the sentence box, and has no text of its own
    expect(badge).toBeTruthy();
    expect(wrap.querySelector('.ap-sentence')).toBeTruthy();
    expect(badge.textContent).toBe('');
    expect(badge.querySelector('svg.ap-ctx__icon')).toBeTruthy(); // the brain-sparkle icon
    expect(badge.getAttribute('aria-label')).toBe('Meeting context: Meeting context off');
    // no full-width row any more
    expect(shadow.querySelector('.ap-brain')).toBeNull();
  });

  it('the icon shows the state: off, listening, analysing, and quicker while a summary is made', async () => {
    const { session } = fakeSession();
    const { shadow } = await on(session);
    const badge = () => shadow.querySelector('.ap-ctx') as HTMLElement;
    expect(badge().classList.contains('ap-ctx--live')).toBe(false);

    await act(async () => {
      session.dispatch({ type: 'CONTEXT', state: 'waiting', summary: null });
    });
    expect(badge().getAttribute('aria-label')).toBe('Meeting context: Listening for the meeting…');
    expect(badge().classList.contains('ap-ctx--live')).toBe(true);

    await act(async () => {
      session.dispatch({
        type: 'CONTEXT',
        state: 'following',
        summary: 'Planning the demo for Friday.',
        updating: false,
      });
    });
    expect(badge().getAttribute('aria-label')).toBe('Meeting context: Analysing the meeting…');
    expect(badge().classList.contains('ap-ctx--live')).toBe(true);
    expect(badge().classList.contains('ap-ctx--busy')).toBe(false);

    await act(async () => {
      session.dispatch({
        type: 'CONTEXT',
        state: 'following',
        summary: 'Planning the demo for Friday.',
        updating: true,
      });
    });
    expect(badge().classList.contains('ap-ctx--busy')).toBe(true);
  });

  it('opens a panel beside the card on hover or focus: the title, then the summary word by word', async () => {
    const { session } = fakeSession();
    const { shadow } = await on(session);
    const tip = () => shadow.querySelector('.ap-context-tip') as HTMLElement | null;
    expect(tip()).toBeNull();
    await act(async () => {
      session.dispatch({
        type: 'CONTEXT',
        state: 'following',
        summary: 'Planning the demo for Friday at three.',
        updating: false,
      });
    });
    await act(async () => {
      fireEvent.focus(shadow.querySelector('.ap-ctx') as HTMLElement);
    });
    await waitFor(() => expect(tip()).toBeTruthy());
    const title = tip()!.querySelector('.ap-context-tip__title') as HTMLElement;
    expect(title.textContent).toBe('Analysing the meeting…');
    expect(title.classList.contains('ap-gemini--live')).toBe(true); // gradient text that moves
    // each word is its own element with its own delay, so the text arrives word by word
    const words = [...tip()!.querySelectorAll('.ap-word')] as HTMLElement[];
    expect(words.map((w) => w.textContent!.trim()).join(' ')).toBe(
      'Planning the demo for Friday at three.',
    );
    expect(words[0]!.style.getPropertyValue('--ap-i')).toBe('0');
    expect(words.at(-1)!.style.getPropertyValue('--ap-i')).toBe(String(words.length - 1));
    expect(tip()!.getAttribute('data-side')).toBe('left'); // beside the card, not over it
    expect(tip()!.textContent).not.toContain('What Ola has picked up so far');
  });

  it('explains in the hover panel how to turn the meeting context on when it is off', async () => {
    const { session } = fakeSession();
    const { shadow } = await on(session);
    await act(async () => {
      fireEvent.focus(shadow.querySelector('.ap-ctx') as HTMLElement);
    });
    await waitFor(() => expect(shadow.querySelector('.ap-context-tip')).toBeTruthy());
    const tip = shadow.querySelector('.ap-context-tip') as HTMLElement;
    expect(tip.querySelector('.ap-context-tip__title')!.textContent).toBe('Meeting context off');
    expect(tip.textContent).toMatch(/Turn it on in Settings/);
  });

  it('writes the status next to the toggle in the header, with its icon, and has no other status row', async () => {
    const { session } = fakeSession();
    const { ui, shadow } = await on(session);
    const head = shadow.querySelector('.ap-card__head') as HTMLElement;
    const status = head.querySelector('[role="status"]') as HTMLElement;
    expect(status.classList.contains('au-pill')).toBe(true);
    expect(status.classList.contains('au-pill--icon')).toBe(false); // words as well as the icon
    expect(status.textContent).toBe('Ready');
    expect(status.querySelector('svg')).toBeTruthy();
    // the toggle is in the same header, right after the status
    expect(status.nextElementSibling?.contains(ui.getByRole('switch', { name: 'Ola' }))).toBe(true);
    // one status in the card, and no words written over the camera picture
    expect(shadow.querySelectorAll('.ap-card [role="status"]')).toHaveLength(1);
    expect(shadow.querySelector('.ap-preview__status')).toBeNull();
  });

  it('keeps the card layout fixed: signs in one row, everything else inside the body, footer outside it', async () => {
    const env = fakeSession();
    const { shadow } = await on(env.session);
    const card = shadow.querySelector('.ap-card') as HTMLElement;
    const body = card.querySelector('.ap-card__body') as HTMLElement;
    const before = Array.from(card.children).map((c) => c.className);
    await act(async () => {
      for (const sign of ['hello', 'please', 'wait', 'thankyou', 'bye'] as const) {
        env.session.dispatch({ type: 'CLIP_READY' });
        env.session.dispatch({ type: 'RECOGNISED', sign, confidence: 0.9, threshold: 0 });
      }
      env.session.dispatch({ type: 'COMPOSE_START' });
      env.session.dispatch({
        type: 'COMPOSED',
        sentence: 'Hello, please wait. Thank you, goodbye.',
      });
    });
    // the same structure before and after: content fills the fixed rows, it does not add rows
    expect(Array.from(card.children).map((c) => c.className)).toEqual(before);
    expect(body.querySelectorAll('.ap-chips')).toHaveLength(1);
    expect(Array.from(card.children).some((c) => c.classList.contains('ap-foot'))).toBe(true);
    expect(body.querySelector('.ap-foot')).toBeNull();
    expect(body.querySelectorAll('.ap-sentence-wrap .ap-ctx')).toHaveLength(1);
  });

  it('lets the signer turn on the Gemini double-check, which is off by default', async () => {
    const { session } = fakeSession();
    const { ui, settings } = await on(session);
    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Settings/i }));
    });
    await act(async () => {
      fireEvent.click(await ui.findByRole('tab', { name: 'Signing' }));
    });
    const toggle = await ui.findByRole('switch', { name: 'Have Gemini double-check signs' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(settings.useStore.getState().settings.cloudCheck).toBe(true);
  });

  it('lets the signer choose how long Ola waits before making a sentence', async () => {
    const { session } = fakeSession();
    const { ui, settings } = await on(session);
    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Settings/i }));
    });
    await act(async () => {
      fireEvent.click(await ui.findByRole('tab', { name: 'Signing' }));
    });
    const group = await ui.findByRole('radiogroup', { name: 'Sentence pause' });
    expect(within(group).getByRole('radio', { name: 'Normal' }).getAttribute('data-state')).toBe(
      'checked',
    );
    await act(async () => {
      fireEvent.click(within(group).getByRole('radio', { name: 'Long' }));
    });
    expect(settings.useStore.getState().settings.pauseMs).toBe(4500);
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
      [{ type: 'LIGHT', dark: true }, 'Poor lighting', /Needs more light/],
      [{ type: 'ONLINE', online: false }, 'Reconnecting…', /Signs saved/],
      [{ type: 'CLIP_DISCARDED', reason: 'tooShort' }, 'Couldn’t recognize that', /Sign again/],
      [{ type: 'HANDS_EDGE', out: true }, 'Hands out of frame', /hands in the frame/],
    ];
    for (const [event, label, hint] of cases) {
      const { session } = fakeSession();
      const { ui, container } = await on(session);
      await act(async () => session.dispatch(event));
      // the header may show a shorter word ("Low light"); the full wording is always the pill's tooltip
      const pill = container.querySelector('.au-pill') as HTMLElement;
      expect(pill.title).toBe(label);
      expect(pill.textContent!.length).toBeGreaterThan(0);
      expect(ui.getByText(hint)).toBeTruthy();
      expect(container.querySelector('.au-banner .au-icon')).toBeTruthy(); // never colour alone
      await act(async () => root.unmount());
      host.remove();
      root = createRoot(document.createElement('div'));
      host = document.createElement('div');
    }
  });

  it('writes the long statuses shorter in the header, with the full wording as the tooltip', async () => {
    const { session } = fakeSession();
    const { shadow } = await on(session);
    const pill = () => shadow.querySelector('.ap-card__head .au-pill') as HTMLElement;
    await act(async () => session.dispatch({ type: 'LIGHT', dark: true }));
    expect(pill().textContent).toBe('Low light');
    expect(pill().title).toBe('Poor lighting');
    await act(async () => session.dispatch({ type: 'ONLINE', online: false }));
    expect(pill().textContent).toBe('Offline');
    expect(pill().title).toBe('Reconnecting…');
  });

  it('camera blocked: explains, offers Fix permissions steps and Try again', async () => {
    const getCamera = vi
      .fn<() => Promise<MediaStream>>()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const { session, track } = fakeSession({ getCamera });
    getCamera.mockResolvedValueOnce({ getTracks: () => [track] } as unknown as MediaStream);
    const { ui } = await mount(session);
    fireEvent.click(ui.getByRole('switch', { name: 'Ola' }));
    expect(await ui.findByText(/Allow it for this site/)).toBeTruthy(); // pill auto-expanded

    fireEvent.click(ui.getByRole('button', { name: 'Fix permissions' }));
    expect(ui.getByText(/camera icon at the right end/)).toBeTruthy();
    expect(ui.getByRole('button', { name: 'Open Chrome camera settings' })).toBeTruthy();

    fireEvent.click(ui.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(session.getState().on).toBe(true));
    expect(getCamera).toHaveBeenCalledTimes(2);
  });
});

describe('speaking, captions and the end-of-call summary', () => {
  const recognised = (sign: 'hello' | 'tomorrow') =>
    ({ type: 'RECOGNISED', sign, confidence: 0.9, threshold: 0.5 }) as const;

  async function onWith(env = fakeSession()) {
    const app = await mount(env.session);
    fireEvent.click(app.ui.getByRole('button', { name: 'Expand Ola' }));
    fireEvent.click(app.ui.getByRole('switch', { name: 'Ola' }));
    await waitFor(() => expect(app.container.querySelector('.au-pill')?.textContent).toBe('Ready'));
    return { ...app, env };
  }
  const withChip = (session: ReturnType<typeof fakeSession>['session']) =>
    act(async () => {
      session.dispatch({ type: 'CLIP_READY' });
      session.dispatch(recognised('hello'));
    });

  it('Speak is disabled with nothing to say; with signs it speaks into the call and shows the caption', async () => {
    const env = fakeSession();
    const { ui, settings } = await onWith(env);
    await act(async () => settings.useStore.getState().update({ speakMode: 'confirm' })); // Speak and Cancel only show in this mode
    expect((ui.getByRole('button', { name: 'Speak' }) as HTMLButtonElement).disabled).toBe(true);
    expect((ui.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);

    await withChip(env.session);
    const speak = ui.getByRole('button', { name: 'Speak' }) as HTMLButtonElement;
    expect(speak.disabled).toBe(false);
    await act(async () => fireEvent.click(speak));
    await waitFor(() => expect(env.voice.spoken).toHaveLength(1));
    const caption = await ui.findByRole('status', { name: 'Ola caption' });
    expect(caption.textContent).toContain('Hello, please wait.');
    expect(caption.textContent).toContain('You'); // default signer name
  });

  it('auto-speak mode has no Speak or Cancel buttons; the hint does not mention Speak', async () => {
    const env = fakeSession();
    const { ui } = await onWith(env);
    expect(ui.queryByRole('button', { name: 'Speak' })).toBeNull();
    expect(ui.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await withChip(env.session);
    const hint = ui.getByText(/Keep signing to build a sentence/);
    expect(hint.textContent).not.toMatch(/press Speak/);
  });

  it('confirm-first shows the sentence in the panel with Speak and Cancel', async () => {
    const env = fakeSession({
      settings: () => ({
        holdTimeMs: 400,
        pauseMs: 1500,
        speakMode: 'confirm',
        voiceId: 'aria',
        speed: 1,
        postToChat: false,
        monitorVoice: true,
      }),
    });
    const { ui, settings } = await onWith(env);
    await act(async () => settings.useStore.getState().update({ speakMode: 'confirm' }));
    await withChip(env.session);
    await act(async () => {
      env.session.dispatch({ type: 'COMPOSE_START' });
      env.session.dispatch({ type: 'COMPOSED', sentence: 'Please wait.' });
    });
    expect(ui.getByLabelText('Sentence').textContent).toBe('Please wait.');
    expect(env.voice.spoken).toHaveLength(0);
    fireEvent.click(ui.getByRole('button', { name: 'Cancel' }));
    expect(env.session.getState().sentence).toBeNull();
  });

  it('caption follows the signer’s name, size and position settings', async () => {
    const env = fakeSession();
    const { ui, settings } = await onWith(env);
    await act(async () =>
      settings.useStore
        .getState()
        .update({ displayName: 'Alex', captionSize: 'large', captionPosition: 'top' }),
    );
    await act(async () => {
      env.session.dispatch({ type: 'CLIP_READY' });
      env.session.dispatch(recognised('hello'));
      env.session.dispatch({ type: 'COMPOSE_START' });
      env.session.dispatch({ type: 'COMPOSED', sentence: 'Please wait.' });
      env.session.dispatch({ type: 'SPEAK_START' });
    });
    const caption = await ui.findByRole('status', { name: 'Ola caption' });
    expect(caption.textContent).toContain('Alex');
    expect(caption.style.fontSize).toBe('26px');
    expect(caption.style.top).toBe('16px');
    expect(caption.getAttribute('aria-live')).toBe('polite');
    expect(caption.querySelector('[aria-label="Speaking"]')).toBeTruthy(); // wave icon with a text name
  });

  it('Audion’s voice switch is remembered and tells the session, with no banner about it', async () => {
    const env = fakeSession();
    const { ui, prefs } = await onWith(env);
    fireEvent.click(ui.getByRole('switch', { name: 'Speak into the call' }));
    await waitFor(() =>
      expect(env.voice.configs.at(-1)).toEqual({ enabled: true, voiceMuted: true }),
    );
    expect(await prefs.get('panelPrefs')).toMatchObject({ voiceMuted: true });
    expect(ui.queryByText(/voice is off/)).toBeNull();
    expect(ui.queryByText(/captions only/)).toBeNull();
  });

  it('warns when Meet’s own microphone is muted, since nobody could hear Audion', async () => {
    const env = fakeSession();
    const { ui } = await onWith(env);
    await act(async () => env.voice.emitChannel({ hasChannel: true, micMuted: true }));
    expect(ui.getByText(/Mic muted/)).toBeTruthy();
    await act(async () => env.voice.emitChannel({ hasChannel: true, micMuted: false }));
    expect(ui.queryByText(/Mic muted/)).toBeNull();
  });

  it('shows the transcript when the call ends, can copy it, and clears it on close', async () => {
    const entries = [
      { text: 'Hello, please wait.', at: new Date(2026, 9, 13, 10, 42).getTime() },
      { text: 'Thank you.', at: new Date(2026, 9, 13, 10, 44).getTime() },
    ];
    vi.mocked(send).mockImplementation((async (req: { type: string }) =>
      req.type === 'transcript/get' ? { ok: true, entries } : { ok: true }) as never);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const env = fakeSession();
    const { ui } = await onWith(env);
    const leave = document.createElement('button');
    leave.setAttribute('aria-label', 'Leave call');
    document.body.append(leave);
    await act(async () => leave.click());

    const card = await ui.findByRole('region', { name: 'Call summary' });
    expect(env.session.getState().on).toBe(false); // leaving also switched Audion off
    const items = within(card).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toMatch(/\d.*Hello, please wait\./);

    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Copy' })));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = (writeText.mock.calls[0] as unknown as string[])[0]!;
    expect(copied.split('\n')).toHaveLength(2);
    expect(copied).toMatch(/^\[.+\] Hello, please wait\.\n\[.+\] Thank you\.$/);
    expect(await within(card).findByText('Copied')).toBeTruthy();

    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Close' })));
    expect(vi.mocked(send)).toHaveBeenCalledWith({ type: 'transcript/clear' });
    expect(ui.queryByRole('region', { name: 'Call summary' })).toBeNull();
    leave.remove();
  });

  it('sends feedback (rating and sign labels only) only when the signer has consented', async () => {
    vi.mocked(send).mockImplementation((async (req: { type: string }) =>
      req.type === 'transcript/get'
        ? { ok: true, entries: [{ text: 'Hello.', at: Date.now() }] }
        : { ok: true }) as never);
    const env = fakeSession();
    const { ui, settings } = await onWith(env);
    await act(async () => {
      env.session.dispatch({ type: 'CLIP_READY' });
      env.session.dispatch(recognised('hello'));
    });
    await act(async () => void (await env.session.speakNow()));

    const leave = document.createElement('button');
    leave.setAttribute('aria-label', 'Leave call');
    document.body.append(leave);
    await act(async () => leave.click());
    const card = await ui.findByRole('region', { name: 'Call summary' });

    // No consent: nothing is sent, and the card explains how to turn it on.
    await act(async () =>
      fireEvent.click(within(card).getByRole('button', { name: 'Yes, accurate' })),
    );
    expect(within(card).getByText(/Feedback is off/)).toBeTruthy();
    expect(
      vi.mocked(send).mock.calls.some(([r]) => (r as { type: string }).type === 'api/feedback'),
    ).toBe(false);

    await act(async () => settings.useStore.getState().update({ feedbackConsent: true }));
    await act(async () =>
      fireEvent.click(within(card).getByRole('button', { name: 'Yes, accurate' })),
    );
    const call = vi
      .mocked(send)
      .mock.calls.find(([r]) => (r as { type: string }).type === 'api/feedback')!;
    expect(call[0]).toEqual({ type: 'api/feedback', rating: 'up', signs: ['hello'] }); // no text, no video
    expect(
      await within(card).findByText(/Only your rating and the sign words were sent/),
    ).toBeTruthy();
    leave.remove();
  });
});
