import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as settingsModule from '../lib/settings';
import { createSettingsStore } from '../lib/settings';
import { memoryStore } from '../lib/storage';
import { AudionApp } from './AudionApp';
import { createPanelStore } from './store';

vi.mock('../lib/messages', async (orig) => ({ ...(await orig<object>()), send: vi.fn() }));

let host: HTMLElement;
let root: Root;

/** Mounts the app exactly like the content script does: React inside a Shadow root. */
async function mount() {
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
    root.render(<AudionApp portalContainer={container} alwaysShow panelStore={panelStore} />);
  });
  await waitFor(() =>
    expect(within(container).getByRole('group', { name: 'Audion' })).toBeTruthy(),
  );
  return { ui: within(container), container, shadow, settings, prefs, panelStore };
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
    expect(ui.getByRole('status').textContent).toBe('Ready');

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
      root.render(<AudionApp portalContainer={container} alwaysShow panelStore={panelStore} />),
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
