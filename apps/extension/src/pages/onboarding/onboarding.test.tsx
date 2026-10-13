import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS } from '@audion/shared';
import { ThemeRoot } from '@audion/ui';

const perms = vi.hoisted(() => ({
  queryPermission: vi.fn(async () => 'prompt'),
  requestMedia: vi.fn(),
}));
vi.mock('../../lib/permissions', () => perms);

const send = vi.hoisted(() => vi.fn());
vi.mock('../../lib/messages', async (orig) => ({ ...(await orig<object>()), send }));
vi.mock('../../lib/audioPlayer', () => ({
  playAudio: vi.fn(async () => ({ done: Promise.resolve(), stop() {} })),
}));
const camera = vi.hoisted(() => ({ recordClip: vi.fn() }));
vi.mock('../../lib/camera', async (orig) => ({
  ...(await orig<object>()),
  recordClip: camera.recordClip,
}));

import { createSettingsStore } from '../../lib/settings';
import { memoryStore } from '../../lib/storage';
import * as settingsModule from '../../lib/settings';
import { Permissions } from './Permissions';
import { Setup } from './Setup';
import { VoicePicker } from './VoicePicker';

function useFreshSettings() {
  const store = createSettingsStore(memoryStore());
  vi.spyOn(settingsModule, 'getSettingsStore').mockReturnValue(store);
  return store;
}
const wrap = (ui: React.ReactNode) => render(<ThemeRoot theme="dark">{ui}</ThemeRoot>);

beforeEach(() => {
  vi.clearAllMocks();
  perms.queryPermission.mockResolvedValue('prompt');
});

describe('Permissions step', () => {
  it('shows Needed, then Allowed after granting, then Continue', async () => {
    perms.requestMedia.mockResolvedValue({ ok: true });
    const onNext = vi.fn();
    wrap(<Permissions onBack={() => {}} onNext={onNext} />);
    expect(screen.getAllByText('Needed')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    await waitFor(() => expect(screen.getAllByText('Allowed')).toHaveLength(2));
    expect(perms.requestMedia).toHaveBeenCalledWith('camera');
    expect(perms.requestMedia).toHaveBeenCalledWith('microphone');

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNext).toHaveBeenCalled();
  });

  it('explains how to recover when the camera is blocked, and can retry', async () => {
    perms.requestMedia.mockImplementation(async (k: string) =>
      k === 'camera' ? { ok: false, problem: 'blocked' } : { ok: true },
    );
    wrap(<Permissions onBack={() => {}} onNext={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    expect(await screen.findByText(/Chrome is blocking this/)).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByText('Allowed')).toBeTruthy(); // microphone still shown as allowed
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('starts as Allowed when Chrome already granted both', async () => {
    perms.queryPermission.mockResolvedValue('granted');
    wrap(<Permissions onBack={() => {}} onNext={() => {}} />);
    await waitFor(() => expect(screen.getAllByText('Allowed')).toHaveLength(2));
  });
});

describe('Voice setup', () => {
  it('saves the chosen voice and speed to settings', async () => {
    const store = useFreshSettings();
    await store.init();
    wrap(<VoicePicker />);
    fireEvent.click(screen.getByRole('radio', { name: /Miles/ }));
    await waitFor(() => expect(store.useStore.getState().settings.voiceId).toBe('miles'));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Speaking speed' }), {
      key: 'ArrowRight',
    });
    await waitFor(() => expect(store.useStore.getState().settings.speed).toBeGreaterThan(1));
  });

  it('plays a sample through the API with the selected voice and speed', async () => {
    const store = useFreshSettings();
    await store.init();
    send.mockResolvedValue({ ok: true, audioBase64: btoa('RIFF'), contentType: 'audio/wav' });
    wrap(<VoicePicker />);
    fireEvent.click(screen.getByRole('button', { name: 'Play David preview' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'api/speak',
          voiceId: 'david',
          speed: SETTINGS_DEFAULTS.speed,
        }),
      ),
    );
  });

  it('tells the user when the service is unreachable', async () => {
    const store = useFreshSettings();
    await store.init();
    send.mockResolvedValue({
      ok: false,
      error: { code: 'NETWORK', message: 'x', retryable: true },
    });
    wrap(<VoicePicker />);
    fireEvent.click(screen.getByRole('button', { name: 'Play Aria preview' }));
    expect(await screen.findByText(/Can’t reach the Audion service/)).toBeTruthy();
  });
});

describe('Calibration in Setup', () => {
  function stubCamera(ok: boolean) {
    const track = { stop: vi.fn() };
    const getUserMedia = ok
      ? vi.fn(async () => ({ getTracks: () => [track] }))
      : vi.fn(async () => Promise.reject({ name: 'NotAllowedError' }));
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    return track;
  }

  it('keeps Finish setup locked until a sign check passes, then unlocks it', async () => {
    useFreshSettings();
    stubCamera(true);
    camera.recordClip.mockResolvedValue({
      blob: new Blob(['x']),
      mime: 'video/webm',
      durationMs: 2500,
    });
    send.mockImplementation(async (r: { type: string }) =>
      r.type === 'api/health'
        ? { ok: true, mode: 'live' }
        : { ok: true, sign: 'hello', confidence: 0.9, alternatives: [], latencyMs: 5 },
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wrap(<Setup onBack={() => {}} onFinish={() => {}} />);
    const finish = screen.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await vi.advanceTimersByTimeAsync(3500);
    await waitFor(() => expect(finish.disabled).toBe(false));
    expect(screen.getByText(/That’s “hello”/)).toBeTruthy();
    vi.useRealTimers();
  });

  it('asks the person to retry when a different sign was seen in live mode', async () => {
    useFreshSettings();
    stubCamera(true);
    camera.recordClip.mockResolvedValue({
      blob: new Blob(['x']),
      mime: 'video/webm',
      durationMs: 2500,
    });
    send.mockImplementation(async (r: { type: string }) =>
      r.type === 'api/health'
        ? { ok: true, mode: 'live' }
        : { ok: true, sign: 'bye', confidence: 0.6, alternatives: [], latencyMs: 5 },
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wrap(<Setup onBack={() => {}} onFinish={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await vi.advanceTimersByTimeAsync(3500);
    expect(await screen.findByText(/We saw “bye”/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    vi.useRealTimers();
  });

  it('shows a fix message when the camera is blocked', async () => {
    useFreshSettings();
    stubCamera(false);
    send.mockResolvedValue({ ok: true, mode: 'live' });
    wrap(<Setup onBack={() => {}} onFinish={() => {}} />);
    expect(await screen.findByText(/Camera blocked/)).toBeTruthy();
  });
});
