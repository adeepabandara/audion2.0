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
// Whether the fake call's outgoing audio picks up Ola's voice while it plays (energy rises with each sound played).
let voiceReachesCall = true;

class FakeSender {
  constructor(public track: { kind: string } | null) {}
  async getStats() {
    const energy = voiceReachesCall ? fake.ctx.played * 0.5 : 0;
    return new Map([['ms', { type: 'media-source', kind: 'audio', totalAudioEnergy: energy }]]);
  }
  async replaceTrack(track: { kind: string } | null) {
    this.track = track;
  }
}
class FakePeerConnection {
  addTrack(track: { kind: string }) {
    return new FakeSender(track);
  }
  addTransceiver(track: { kind: string }) {
    return { sender: new FakeSender(track) };
  }
}

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
  voiceReachesCall = true;
  (window as unknown as Record<string, unknown>).RTCPeerConnection = FakePeerConnection;
  (window as unknown as Record<string, unknown>).RTCRtpSender = FakeSender;
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

describe('audio engine state', () => {
  it('resumes a suspended audio engine at once and again on the first click, so the voice and the mic are not silent', async () => {
    fake.ctx.state = 'suspended';
    // This fake only comes back to life when asked to resume *after* a gesture, like Chrome without user activation.
    let allowed = false;
    fake.ctx.resume = vi.fn(async () => {
      fake.ctx.resumed++;
      if (allowed) fake.ctx.state = 'running';
    });
    await gum({ audio: true });
    expect(fake.ctx.resumed).toBe(1); // tried immediately, still suspended

    allowed = true;
    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.ctx.state).toBe('running');
    const tries = fake.ctx.resumed;
    window.dispatchEvent(new Event('pointerdown'));
    expect(fake.ctx.resumed).toBe(tries); // stopped listening once it was running
  });

  it('does nothing extra when the engine is already running', async () => {
    await gum({ audio: true });
    expect(fake.ctx.resumed).toBe(0);
  });
});

describe('several microphone streams (Meet asks more than once)', () => {
  it('speaks into every stream Meet is holding, not only the newest one', async () => {
    await send(toInject({ type: 'config', enabled: true, voiceMuted: false }));
    await gum({ audio: true });
    await gum({ audio: true }); // e.g. the preview before joining, then the call
    await send(toInject({ type: 'speak', id: 1, audio: new ArrayBuffer(4) }));
    expect(last('speak-result')).toMatchObject({ id: 1, result: 'done' });
    expect(fake.ctx.played).toBe(2); // the voice went into both
  });

  it('keeps the channel until the last stream is stopped, and counts Meet as muted only when all are', async () => {
    const a = (await gum({ audio: true })).getAudioTracks()[0]!;
    const b = (await gum({ audio: true })).getAudioTracks()[0]!;
    a.enabled = false;
    expect(last('channel')).toMatchObject({ hasChannel: true, micMuted: false });
    b.enabled = false;
    expect(last('channel')).toMatchObject({ micMuted: true });
    a.stop();
    expect(last('channel')).toMatchObject({ hasChannel: true });
    b.stop();
    expect(last('channel')).toMatchObject({ hasChannel: false });
  });
});

describe('did the voice reach the call?', () => {
  const speakOnce = async () => {
    await send(toInject({ type: 'config', enabled: true, voiceMuted: false }));
    const track = (await gum({ audio: true })).getAudioTracks()[0]!;
    return track;
  };

  it('says yes when the call’s outgoing audio picked the voice up while it played', async () => {
    const track = await speakOnce();
    new (
      window as unknown as { RTCPeerConnection: typeof FakePeerConnection }
    ).RTCPeerConnection().addTrack(track as unknown as { kind: string });
    await send(toInject({ type: 'speak', id: 1, audio: new ArrayBuffer(4) }));
    expect(last('speak-result')).toMatchObject({ result: 'done', sent: true });
  });

  it('says no when Meet is not sending the voice (the call’s audio did not change)', async () => {
    voiceReachesCall = false;
    const track = await speakOnce();
    new (
      window as unknown as { RTCPeerConnection: typeof FakePeerConnection }
    ).RTCPeerConnection().addTrack(track as unknown as { kind: string });
    await send(toInject({ type: 'speak', id: 2, audio: new ArrayBuffer(4) }));
    expect(last('speak-result')).toMatchObject({ result: 'done', sent: false });
  });

  it('says unknown (null) when no call connection was seen, and never throws', async () => {
    await speakOnce();
    await send(toInject({ type: 'speak', id: 3, audio: new ArrayBuffer(4) }));
    expect(last('speak-result')).toMatchObject({ result: 'done', sent: null });
  });

  it('also recognises connections made with addTransceiver and replaceTrack', async () => {
    const track = await speakOnce();
    const W = window as unknown as { RTCPeerConnection: typeof FakePeerConnection };
    const { sender } = new W.RTCPeerConnection().addTransceiver(
      track as unknown as { kind: string },
    );
    await sender.replaceTrack(track as unknown as { kind: string });
    await send(toInject({ type: 'speak', id: 4, audio: new ArrayBuffer(4) }));
    expect(last('speak-result')).toMatchObject({ sent: true });
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
    await send(toInject({ type: 'speak', id: 22, audio: new ArrayBuffer(4), monitor: true }));
    expect(last('speak-result')).toMatchObject({ id: 22, result: 'done' });
    expect(fake.ctx.played).toBe(2); // the plain one and the monitored one
    expect(fake.edges.filter(([, to]) => to === 'speakers')).toHaveLength(1); // only the monitored one is audible here

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

describe('never breaking the call', () => {
  it('if our audio setup throws, Meet gets the plain stream untouched', async () => {
    (window as unknown as Record<string, unknown>).AudioContext = function () {
      throw new Error('AudioContext blocked');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stream = await gum({ audio: true, video: true });
    const real = (await original.mock.results.at(-1)!.value) as FakeStream;
    expect(stream).toBe(real); // exactly what Chrome gave us
    expect(stream.getAudioTracks()[0]!.label).toBe('Built-in mic');
    expect(warn).toHaveBeenCalled();
    expect(last('channel')?.hasChannel ?? false).toBe(false);
  });

  it('with no microphone and a broken AudioContext, the original error still reaches Meet', async () => {
    (window as unknown as Record<string, unknown>).AudioContext = function () {
      throw new Error('boom');
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    original.mockImplementationOnce(async () => {
      throw Object.assign(new Error('none'), { name: 'NotFoundError' });
    });
    await expect(gum({ audio: true })).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});
