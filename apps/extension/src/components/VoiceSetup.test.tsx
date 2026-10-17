import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeRoot } from '@audion/ui';

const send = vi.hoisted(() => vi.fn());
vi.mock('../lib/messages', async (orig) => ({ ...(await orig<object>()), send }));
vi.mock('../lib/audioPlayer', () => ({
  playAudio: vi.fn(async () => ({
    done: Promise.resolve(),
    stop() {},
    duration: 2,
    elapsed: () => 2,
    peaks: Array.from({ length: 56 }, (_, i) => (i % 7) / 7),
  })),
}));

import { createSettingsStore } from '../lib/settings';
import { memoryStore } from '../lib/storage';
import * as settingsModule from '../lib/settings';
import { SAMPLE_LINE } from './VoicePicker';
import { VoiceSetup } from './VoiceSetup';

function setup() {
  const store = createSettingsStore(memoryStore());
  vi.spyOn(settingsModule, 'getSettingsStore').mockReturnValue(store);
  const onSaved = vi.fn();
  render(
    <ThemeRoot theme="dark">
      <VoiceSetup onSaved={onSaved} />
    </ThemeRoot>,
  );
  return { store, onSaved };
}
const choose = (group: string, option: string) =>
  fireEvent.click(
    within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: option }),
  );
const names = () =>
  within(screen.getByRole('radiogroup', { name: 'Suggested voices' }))
    .getAllByRole('radio')
    .map((r) => r.closest('label')!.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(async (req: { type: string }) =>
    req.type === 'api/speak'
      ? { ok: true, audioBase64: btoa('audio'), contentType: 'audio/mpeg' }
      : { ok: true, heard: SAMPLE_LINE, mode: 'google' },
  );
});

describe('Voice setup', () => {
  it('asks five questions and suggests three voices that fit the answers', () => {
    setup();
    for (const q of [
      'How should your voice sound?',
      'How old should it feel?',
      'How fast do you like to talk?',
      'What tone suits you?',
      'Which English accent?',
    ])
      expect(screen.getByRole('radiogroup', { name: q })).toBeTruthy();
    expect(names()).toEqual(['Aria', 'Nora', 'Ivy']);
  });

  it('changes the suggestions and the plain-words description when the answers change', () => {
    setup();
    expect(screen.getByText(/Medium-high voice, steady pace, American accent/)).toBeTruthy();
    choose('How should your voice sound?', 'Masculine');
    choose('Which English accent?', 'British');
    expect(names()).toEqual(['Arthur', 'Henry', 'Oscar']);
    choose('What tone suits you?', 'Deep');
    choose('How fast do you like to talk?', 'Calm');
    expect(screen.getByText(/Deep voice, calm pace, British accent/)).toBeTruthy();
  });

  it('plays the sample with the chosen pitch and pace, and draws the shape of the sound', async () => {
    setup();
    choose('What tone suits you?', 'Deep');
    fireEvent.click(screen.getByRole('button', { name: /Hear it/ }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]![0]).toMatchObject({
      type: 'api/speak',
      text: SAMPLE_LINE,
      voiceId: 'aria',
      pitch: -3,
      speed: 1,
    });
    expect(await screen.findByRole('img', { name: /Shape of the sound/ })).toBeTruthy();
  });

  it('shows, in words, what people will hear and whether it was clear', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /What will people hear/ }));
    expect(await screen.findByText(/Clear: every word was understood/)).toBeTruthy();
    expect(screen.getByText(/People will hear:/).textContent).toContain('signing with you');
    expect(send.mock.calls[0]![0]).toMatchObject({ type: 'api/voiceCheck', voiceId: 'aria' });
  });

  it('names the words that were missed', async () => {
    send.mockResolvedValueOnce({
      ok: true,
      heard: 'Hello I’m signing with you please wait moment',
      mode: 'google',
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /What will people hear/ }));
    expect(await screen.findByText(/Mostly clear\. Missed: a\./)).toBeTruthy();
  });

  it('says plainly that test mode did not really check anything', async () => {
    send.mockResolvedValueOnce({ ok: true, heard: SAMPLE_LINE, mode: 'mock' });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /What will people hear/ }));
    expect(await screen.findByText(/Test mode: nothing was really checked/)).toBeTruthy();
    expect(screen.queryByText(/Clear:/)).toBeNull();
  });

  it('keeps the old result out of sight once the voice changes', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /What will people hear/ }));
    await screen.findByText(/People will hear:/);
    choose('What tone suits you?', 'Crisp');
    expect(screen.queryByText(/People will hear:/)).toBeNull();
  });

  it('saves the voice, pitch and pace as the signer’s voice', async () => {
    const { store, onSaved } = setup();
    choose('How should your voice sound?', 'Masculine');
    choose('What tone suits you?', 'Deep');
    fireEvent.click(screen.getByRole('button', { name: 'Use this voice' }));
    await waitFor(() => expect(store.useStore.getState().settings.voiceSetupDone).toBe(true));
    expect(store.useStore.getState().settings).toMatchObject({
      voiceId: 'david',
      pitch: -3,
      speed: 1,
    });
    expect(await screen.findByText(/Saved as your voice/)).toBeTruthy();
    expect(onSaved).toHaveBeenCalled();
  });

  it('tells the signer briefly when Ola cannot be reached', async () => {
    send.mockResolvedValueOnce({
      ok: false,
      error: { code: 'NETWORK', message: 'x', retryable: true },
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Hear it/ }));
    expect(await screen.findByText('Can’t reach Ola. Try again.')).toBeTruthy();
  });
});
