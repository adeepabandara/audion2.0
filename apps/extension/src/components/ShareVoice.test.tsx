import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeRoot } from '@audion/ui';
import type { VoiceProfile } from '@audion/shared';

const send = vi.hoisted(() => vi.fn());
vi.mock('../lib/messages', async (orig) => ({ ...(await orig<object>()), send }));
vi.mock('../lib/audioPlayer', () => ({
  analyseAudio: vi.fn(async () => ({
    duration: 12.4,
    peaks: Array.from({ length: 56 }, (_, i) => (i % 5) / 5),
  })),
  playAudio: vi.fn(async () => ({
    done: Promise.resolve(),
    stop() {},
    duration: 12.4,
    elapsed: () => 12.4,
    peaks: [],
  })),
}));

import { createSettingsStore } from '../lib/settings';
import { memoryStore } from '../lib/storage';
import * as settingsModule from '../lib/settings';
import { ShareVoice } from './ShareVoice';

const profile: VoiceProfile = { voiceId: 'aria', pitch: -1, speed: 1 };
const speakCalls = () =>
  send.mock.calls.map((c) => c[0]).filter((r: { type: string }) => r.type === 'api/speak');

async function open(props: Partial<React.ComponentProps<typeof ShareVoice>> = {}) {
  const store = createSettingsStore(memoryStore());
  await store.useStore.getState().update({ displayName: 'Adeepa' });
  vi.spyOn(settingsModule, 'getSettingsStore').mockReturnValue(store);
  const onProfileChange = vi.fn();
  const onAnotherVoice = vi.fn();
  const view = (p: VoiceProfile) => (
    <ThemeRoot theme="dark">
      <ShareVoice
        open
        onOpenChange={() => {}}
        profile={p}
        onProfileChange={onProfileChange}
        onAnotherVoice={onAnotherVoice}
        {...props}
      />
    </ThemeRoot>
  );
  const r = render(view(profile));
  await screen.findByText('0:12'); // the first voice note is ready
  return { onProfileChange, onAnotherVoice, rerender: (p: VoiceProfile) => r.rerender(view(p)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(async (req: { type: string; text?: string }) =>
    req.type === 'api/translate'
      ? { ok: true, text: `[es] ${req.text}` }
      : { ok: true, audioBase64: btoa('mp3-bytes'), contentType: 'audio/mpeg' },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
});

describe('Ask someone to listen', () => {
  it('opens with a family message signed with your name, and a voice note of that message in your voice', async () => {
    await open();
    const message = screen.getByRole('textbox', { name: /^Message/ }) as HTMLTextAreaElement;
    expect(message.value).toContain('I’m choosing my voice in Ola');
    expect(message.value).toMatch(/— Adeepa$/);
    const [call] = speakCalls();
    expect(call).toMatchObject({ voiceId: 'aria', speed: 1, pitch: -1 });
    expect(call.text).not.toMatch(/\p{Extended_Pictographic}/u); // the voice does not read emoji
    expect(call.text).toContain('Does it sound like me?');
    expect(screen.getByRole('button', { name: /Play\. Voice note, 12 seconds/ })).toBeTruthy();
    expect(screen.getByText(/Medium-high voice|Medium voice/)).toBeTruthy(); // the voice in plain words
  });

  it('changes the message and the voice note when another style is chosen, and adds the name', async () => {
    await open();
    fireEvent.click(screen.getByRole('radio', { name: 'Colleague' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: /^Message/ }) as HTMLTextAreaElement).value,
      ).toMatch(/^Hello,/),
    );
    const name = screen.getByLabelText(/Who is it for/);
    fireEvent.change(name, { target: { value: 'Dilini' } });
    fireEvent.blur(name);
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: /^Message/ }) as HTMLTextAreaElement).value,
      ).toMatch(/^Hello Dilini,/),
    );
    await waitFor(() => expect(speakCalls().length).toBeGreaterThanOrEqual(3));
  });

  it('translates the message and speaks it in that language when one is picked', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Message language'), { target: { value: 'es' } });
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: /^Message/ }) as HTMLTextAreaElement).value,
      ).toMatch(/^\[es\] /),
    );
    await waitFor(() => expect(speakCalls().at(-1)).toMatchObject({ language: 'es' }));
  });

  it('offers to update the voice note once the message is edited', async () => {
    await open();
    expect(screen.queryByRole('button', { name: 'Update the voice note' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: /^Message/ }), {
      target: { value: 'My own words.' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Update the voice note' }));
    await waitFor(() => expect(speakCalls().at(-1).text).toBe('My own words.'));
  });

  it('shares the message with the voice note attached through the device share sheet', async () => {
    const share = vi.fn(async (_data: unknown) => {});
    Object.assign(navigator, { share, canShare: () => true });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Share…' }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    const data = share.mock.calls[0]![0] as { text: string; files: File[] };
    expect(data.text).toContain('Does it sound like me?');
    expect(data.files[0]!.name).toBe('ola-voice-note.mp3');
    expect(data.files[0]!.type).toBe('audio/mpeg');
  });

  it('shares only the message, and says to attach the note, when files cannot be shared', async () => {
    const share = vi.fn(async (_data: unknown) => {});
    Object.assign(navigator, { share, canShare: () => false });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Share…' }));
    await screen.findByText(/Download the voice note and attach it\./);
    expect((share.mock.calls[0]![0] as { files?: unknown }).files).toBeUndefined();
  });

  it('says what to do when sharing is not available at all', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Share…' }));
    expect(await screen.findByText(/Sharing isn’t available here/)).toBeTruthy();
  });

  it('downloads the voice note and copies the message', async () => {
    const created = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Download voice note' }));
    expect(created).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(screen.getByText('Voice note downloaded.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Does it sound like me?')),
    );
    expect(screen.getByText('Message copied.')).toBeTruthy();
  });

  it('adjusts the voice from their reply, and makes a new voice note for it', async () => {
    const { onProfileChange, rerender } = await open();
    fireEvent.click(screen.getByRole('button', { name: /A bit higher/ }));
    expect(onProfileChange).toHaveBeenCalledWith({ voiceId: 'aria', pitch: 0.5, speed: 1 });
    expect(screen.getByText(/Made it a bit higher\. Listen to the new note\./)).toBeTruthy();
    const before = speakCalls().length;
    rerender({ voiceId: 'aria', pitch: 0.5, speed: 1 }); // the parent applies the change
    await waitFor(() => expect(speakCalls().length).toBe(before + 1));
    expect(speakCalls().at(-1)).toMatchObject({ pitch: 0.5 });
    await screen.findByText('0:12');
    // The reply's message is still shown once the new note is ready.
    expect(screen.getByText(/Made it a bit higher\. Listen to the new note\./)).toBeTruthy();
  });

  it('leaves the voice alone for "sounds like me", and passes "try another voice" on', async () => {
    const { onProfileChange, onAnotherVoice } = await open();
    fireEvent.click(screen.getByRole('button', { name: /Sounds like me/ }));
    expect(onProfileChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Great, it sounds right to them/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try another voice/ }));
    expect(onAnotherVoice).toHaveBeenCalled();
  });

  it('says so briefly when the voice note cannot be made, and keeps sharing off', async () => {
    send.mockResolvedValue({
      ok: false,
      error: { code: 'NETWORK', message: 'x', retryable: true },
    });
    render(
      <ThemeRoot theme="dark">
        <ShareVoice open onOpenChange={() => {}} profile={profile} onProfileChange={() => {}} />
      </ThemeRoot>,
    );
    expect(await screen.findByText('Can’t reach Ola. Try again.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Share…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('states what happens to the data', async () => {
    await open();
    expect(screen.getByText(/stays on this device/)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Ask someone to listen' })).toBeTruthy();
    act(() => {});
  });
});
