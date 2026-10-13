import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeStream, FakeTrack, makeFakeContext } from '../testing/fakeAudio';
import { CONTENT_SOURCE, INJECT_SOURCE, type FromInject } from '../lib/voiceProtocol';
import { installInject } from './install';

type W = Parameters<typeof installInject>[0];
let posted: FromInject[];
let fake: ReturnType<typeof makeFakeContext>;
let original: ReturnType<typeof vi.fn>;
let win: W;
let uninstall: () => void;

beforeEach(() => {
  (globalThis as unknown as { MediaStreamTrack: unknown }).MediaStreamTrack = FakeTrack;
  fake = makeFakeContext();
  original = vi.fn(
    async (c: MediaStreamConstraints) =>
      new FakeStream([
        ...(c.audio ? [new FakeTrack('audio', 'Built-in mic')] : []),
        ...(c.video ? [new FakeTrack('video', 'Cam')] : []),
      ]) as unknown as MediaStream,
  );
  const md = { getUserMedia: original };
  Object.defineProperty(window.navigator, 'mediaDevices', { value: md, configurable: true });
  (window as unknown as Record<string, unknown>).AudioContext = function () {
    return fake.ctx;
  };
  (window as unknown as Record<string, unknown>).MediaStream = FakeStream;
  posted = [];
  vi.spyOn(window, 'postMessage').mockImplementation(
    ((m: FromInject) => void posted.push(m)) as never,
  );
  win = window as unknown as W;
  uninstall = installInject(win);
});
afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

const gum = (c: MediaStreamConstraints) =>
  window.navigator.mediaDevices.getUserMedia(c) as unknown as Promise<FakeStream>;
const send = async (data: unknown, over: Partial<MessageEventInit> = {}) => {
  window.dispatchEvent(
    new MessageEvent('message', { data, source: window, origin: window.location.origin, ...over }),
  );
  await new Promise((r) => setTimeout(r, 0));
};
const toInject = (msg: Record<string, unknown>) => ({ source: CONTENT_SOURCE, ...msg });
const last = <T extends FromInject['type']>(type: T) =>
  [...posted].reverse().find((m) => m.type === type) as
    | Extract<FromInject, { type: T }>
    | undefined;

describe('getUserMedia wrapper', () => {
  it('returns Meet an audio track from the mixer, with the camera tracks untouched', async () => {
    const stream = await gum({ audio: true, video: true });
    expect(stream.getVideoTracks()).toHaveLength(1);
    expect(stream.getAudioTracks()).toHaveLength(1);
    const realMic = (await original.mock.results[0]!.value).getAudioTracks()[0];
    expect(stream.getAudioTracks()[0]).not.toBe(realMic); // Meet gets the mixer's track, never the raw mic
    expect(original).toHaveBeenCalledWith({ audio: true, video: true });
    expect(last('channel')).toMatchObject({ hasChannel: true, micMuted: false });
  });

  it('keeps the real label and settings so Meet’s device picker still works', async () => {
    const track = (await gum({ audio: true })).getAudioTracks()[0]!;
    expect(track.label).toBe('Built-in mic');
    expect(track.getSettings()).toMatchObject({ deviceId: 'real-mic' });
  });

  it('does not touch video-only requests', async () => {
    const s = await gum({ video: true });
    expect(s.getAudioTracks()).toHaveLength(0);
    expect(fake.edges).toEqual([]); // no mixer was built
  });

  it('is installed only once', () => {
    const before = window.navigator.mediaDevices.getUserMedia;
    installInject(win);
    expect(window.navigator.mediaDevices.getUserMedia).toBe(before);
  });

  it('still gives Meet a voice channel when there is no microphone, but never overrides a denial', async () => {
    original.mockImplementationOnce(async () => {
      throw Object.assign(new Error('none'), { name: 'NotFoundError' });
    });
    const s = await gum({ audio: true, video: true });
    expect(original).toHaveBeenLastCalledWith({ audio: false, video: true });
    expect(s.getAudioTracks()).toHaveLength(1);
    expect(s.getVideoTracks()).toHaveLength(1);

    original.mockImplementationOnce(async () => {
      throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
    });
    await expect(gum({ audio: true })).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('notices when Meet mutes and unmutes, and the mute still takes effect', async () => {
    const track = (await gum({ audio: true })).getAudioTracks()[0]!;
    track.enabled = false;
    expect(track.enabled).toBe(false);
    expect(last('channel')).toMatchObject({ micMuted: true });
    track.enabled = true;
    expect(last('channel')).toMatchObject({ micMuted: false });
  });

  it('releases the real microphone and closes the mixer when Meet stops the track', async () => {
    const stream = await gum({ audio: true, video: true });
    const realMic = (await original.mock.results[0]!.value).getAudioTracks()[0] as FakeTrack;
    stream.getAudioTracks()[0]!.stop();
    expect(realMic.stopped).toBe(true);
    expect(fake.ctx.closed).toBe(true);
    expect(last('channel')).toMatchObject({ hasChannel: false });
  });
});

describe('message protocol', () => {
  it('plays Audion’s voice into the call only after being enabled', async () => {
    await gum({ audio: true });
    await send(toInject({ type: 'speak', id: 1, audio: new ArrayBuffer(4) }));
    expect(last('speak-result')).toMatchObject({ id: 1, result: 'disabled' });

    await send(toInject({ type: 'config', enabled: true, voiceMuted: false }));
    await send(toInject({ type: 'speak', id: 2, audio: new ArrayBuffer(4) }));
    expect(last('speak-result')).toMatchObject({ id: 2, result: 'done' });
    expect(fake.ctx.played).toBe(1);

    await send(toInject({ type: 'config', enabled: true, voiceMuted: true }));
    await send(toInject({ type: 'speak', id: 3, audio: new ArrayBuffer(4) }));
    expect(last('speak-result')).toMatchObject({ id: 3, result: 'muted' });

    // Turning Audion off restores the plain microphone: nothing of Audion is added any more.
    await send(toInject({ type: 'config', enabled: false, voiceMuted: false }));
    await send(toInject({ type: 'speak', id: 4, audio: new ArrayBuffer(4) }));
    expect(last('speak-result')).toMatchObject({ id: 4, result: 'disabled' });
  });

  it('says no-channel when Meet never asked for the microphone (tab needs a reload)', async () => {
    await send(toInject({ type: 'config', enabled: true, voiceMuted: false }));
    await send(toInject({ type: 'speak', id: 9, audio: new ArrayBuffer(4) }));
    expect(last('speak-result')).toMatchObject({ id: 9, result: 'no-channel' });
  });

  it('applies the enabled/muted settings that arrived before the mic was requested', async () => {
    await send(toInject({ type: 'config', enabled: true, voiceMuted: false }));
    await gum({ audio: true });
    await send(toInject({ type: 'speak', id: 5, audio: new ArrayBuffer(4) }));
    expect(last('speak-result')).toMatchObject({ result: 'done' });
  });

  it('probe reports the channel, the mute state and the output level', async () => {
    await gum({ audio: true });
    fake.analyserData.fill = 200;
    await send(toInject({ type: 'probe', id: 7 }));
    const p = last('probe-result')!;
    expect(p).toMatchObject({ id: 7, hasChannel: true, micMuted: false });
    expect(p.peak).toBeGreaterThan(0.5);
  });

  it('ignores messages from other origins, other windows and without the tag', async () => {
    await gum({ audio: true });
    await send(toInject({ type: 'config', enabled: true, voiceMuted: false }));
    posted.length = 0;
    await send(toInject({ type: 'speak', id: 1, audio: new ArrayBuffer(4) }), {
      origin: 'https://evil.example',
    });
    await send(toInject({ type: 'speak', id: 2, audio: new ArrayBuffer(4) }), { source: null });
    await send({ type: 'speak', id: 3, audio: new ArrayBuffer(4) });
    await send({ source: INJECT_SOURCE, type: 'speak', id: 4 });
    expect(posted.filter((m) => m.type === 'speak-result')).toEqual([]);
    expect(fake.ctx.played).toBe(0);
  });
});
