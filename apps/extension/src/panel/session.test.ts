import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LandmarkFrame } from '../lib/landmarks';
import { makeFrames, makeHand, type Segment } from '../testing/fixtures';
import { phaseOf, viewOf } from './machine';
import { fakeVoice } from '../testing/fakeSession';
import { AudionSession, type SessionDeps } from './session';

afterEach(() => vi.useRealTimers());

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(
  opts: {
    recognize?: (n: number) => unknown;
    luminance?: () => number | null;
    camera?: () => Promise<MediaStream>;
    trackerStart?: () => Promise<void>;
    compose?: (r: unknown) => unknown;
    speak?: (r: unknown) => unknown;
  } = {},
) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const recorder = {
    arm: vi.fn(),
    disarm: vi.fn(),
    signStarted: vi.fn(),
    finish: vi.fn(async () => ({
      blob: new Blob(['clip-bytes']),
      mime: 'video/webm',
      durationMs: 1400,
    })),
  };
  const voice = fakeVoice();
  const chat = vi.fn(async () => 'sent' as 'sent' | 'draft' | 'no-chat' | 'failed');
  const settingsRef = {
    current: {
      holdTimeMs: 400,
      pauseMs: 1500,
      speakMode: 'auto' as 'auto' | 'confirm',
      voiceId: 'aria' as const,
      speed: 1,
      postToChat: false,
    },
  };
  let recognizeCalls = 0;
  const sent: unknown[] = [];
  const tracker = {
    start: vi.fn(opts.trackerStart ?? (async () => {})),
    detect: vi.fn(),
    stop: vi.fn(),
  };
  const deps: SessionDeps = {
    tracker,
    getCamera: opts.camera ?? (async () => stream),
    createRecorder: () => recorder,
    send: vi.fn(async (req) => {
      sent.push(req);
      if (req.type === 'api/health') return { ok: true, mode: 'mock', confidenceThreshold: 0.5 };
      if (req.type === 'api/compose')
        return opts.compose?.(req) ?? { ok: true, sentence: 'Hello, please wait.' };
      if (req.type === 'api/speak')
        return (
          opts.speak?.(req) ?? {
            ok: true,
            audioBase64: btoa('RIFF-audio'),
            contentType: 'audio/wav',
          }
        );
      if (req.type === 'transcript/add') return { ok: true };
      return (
        opts.recognize ??
        (() => ({ ok: true, sign: 'hello', confidence: 0.9, alternatives: [], latencyMs: 1 }))
      )(++recognizeCalls);
    }),
    settings: () => settingsRef.current,
    voice,
    chat,
    luminance: opts.luminance ?? (() => 120),
    now: () => 0,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  const session = new AudionSession(deps);
  const feed = async (segments: Segment[] | LandmarkFrame[]) => {
    const frames =
      (segments as Segment[])[0] && 'kind' in (segments as Segment[])[0]!
        ? makeFrames(segments as Segment[])
        : (segments as LandmarkFrame[]);
    for (const f of frames) await session.tick(f);
    await flush();
  };
  return {
    session,
    deps,
    tracker,
    recorder,
    track,
    sent,
    feed,
    stream,
    voice,
    chat,
    settings: settingsRef.current,
  };
}

const ONE_SIGN: Segment[] = [
  { kind: 'still', ms: 300 },
  { kind: 'move', ms: 1500 },
  { kind: 'still', ms: 700 },
];

describe('AudionSession', () => {
  it('signing in front of the camera produces a chip (camera -> tracker -> segmenter -> recorder -> API)', async () => {
    const h = harness();
    await h.session.turnOn();
    expect(phaseOf(h.session.getState())).toBe('ready');
    expect(h.tracker.start).toHaveBeenCalled();

    await h.feed(ONE_SIGN);
    const s = h.session.getState();
    expect(s.chips).toMatchObject([{ sign: 'hello', state: 'normal' }]);
    expect(h.recorder.arm).toHaveBeenCalled();
    expect(h.recorder.signStarted).toHaveBeenCalled();
    expect(h.recorder.finish).toHaveBeenCalledTimes(1);
    const rec = h.sent.find((r) => (r as { type: string }).type === 'api/recognize') as {
      mime: string;
      durationMs: number;
      clipBase64: string;
    };
    expect(rec).toMatchObject({ mime: 'video/webm', durationMs: 1400 });
    expect(atob(rec.clipBase64)).toBe('clip-bytes'); // the recorded bytes, in memory, sent once
    expect(phaseOf(s)).toBe('seeing'); // hands still in view
  });

  it('recognises several signs in order', async () => {
    const signs = ['hello', 'please', 'wait'];
    const h = harness({
      recognize: (n) => ({
        ok: true,
        sign: signs[n - 1],
        confidence: 0.9,
        alternatives: [],
        latencyMs: 1,
      }),
    });
    await h.session.turnOn();
    const one: Segment[] = [
      { kind: 'move', ms: 1000 },
      { kind: 'still', ms: 700 },
    ];
    await h.feed([{ kind: 'still', ms: 200 }, ...one, ...one, ...one, { kind: 'none', ms: 300 }]);
    expect(h.session.getState().chips.map((c) => c.sign)).toEqual(signs);
  });

  it('low-confidence answers wait for confirmation; Yes confirms, Try again removes', async () => {
    const h = harness({
      recognize: () => ({
        ok: true,
        sign: 'tomorrow',
        confidence: 0.3,
        alternatives: [],
        latencyMs: 1,
      }),
    });
    await h.session.turnOn();
    await h.feed(ONE_SIGN);
    expect(h.session.getState().chips[0]).toMatchObject({
      sign: 'tomorrow',
      state: 'lowConfidence',
    });
    h.session.confirmYes();
    expect(h.session.getState().chips[0]!.state).toBe('confirmed');

    const h2 = harness({
      recognize: () => ({
        ok: true,
        sign: 'tomorrow',
        confidence: 0.3,
        alternatives: [],
        latencyMs: 1,
      }),
    });
    await h2.session.turnOn();
    await h2.feed(ONE_SIGN);
    h2.session.confirmRetry();
    expect(h2.session.getState().chips).toEqual([]);
  });

  it('uses the confidence threshold the API reports', async () => {
    const h = harness({
      recognize: () => ({
        ok: true,
        sign: 'hello',
        confidence: 0.6,
        alternatives: [],
        latencyMs: 1,
      }),
    });
    (h.deps.send as ReturnType<typeof vi.fn>).mockImplementation(async (req: { type: string }) =>
      req.type === 'api/health'
        ? { ok: true, mode: 'mock', confidenceThreshold: 0.8 }
        : { ok: true, sign: 'hello', confidence: 0.6, alternatives: [], latencyMs: 1 },
    );
    await h.session.turnOn();
    await flush();
    await h.feed(ONE_SIGN);
    expect(h.session.getState().chips[0]!.state).toBe('lowConfidence');
  });

  it('shows "couldn’t recognize that" for unknown signs, then clears it by itself', async () => {
    vi.useFakeTimers();
    const h = harness({
      recognize: () => ({
        ok: true,
        sign: 'unknown',
        confidence: 0.1,
        alternatives: [],
        latencyMs: 1,
      }),
    });
    await h.session.turnOn();
    for (const f of makeFrames(ONE_SIGN)) await h.session.tick(f);
    await vi.advanceTimersByTimeAsync(10);
    expect(viewOf(h.session.getState()).label).toBe('Couldn’t recognize that');
    expect(h.session.getState().chips).toEqual([]);
    await vi.advanceTimersByTimeAsync(4100);
    expect(h.session.getState().problems).toEqual([]);
  });

  it('discards motions that are too short and asks to try again slowly', async () => {
    const h = harness();
    await h.session.turnOn();
    await h.feed([
      { kind: 'still', ms: 300 },
      { kind: 'move', ms: 300 },
      { kind: 'still', ms: 800 },
    ]);
    expect(h.session.getState().problems).toContain('notRecognised');
    expect(viewOf(h.session.getState()).hint).toBe('Try again slowly.');
    expect(h.recorder.finish).not.toHaveBeenCalled();
    expect(h.sent.some((r) => (r as { type: string }).type === 'api/recognize')).toBe(false);
  });

  it('queues clips while offline and delivers them when the API returns', async () => {
    vi.useFakeTimers();
    let n = 0;
    const h = harness({
      recognize: () =>
        ++n < 3
          ? { ok: false, error: { code: 'NETWORK', message: 'down', retryable: true } }
          : { ok: true, sign: 'hello', confidence: 0.9, alternatives: [], latencyMs: 1 },
    });
    await h.session.turnOn();
    for (const f of makeFrames(ONE_SIGN)) await h.session.tick(f);
    await vi.advanceTimersByTimeAsync(10);
    expect(viewOf(h.session.getState())).toMatchObject({
      status: 'reconnecting',
      label: 'Reconnecting…',
    });
    expect(h.session.getState().chips).toEqual([]);
    expect(h.session.getState().inFlight).toBe(1); // held, not lost

    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(4100);
    expect(h.session.getState().chips.map((c) => c.sign)).toEqual(['hello']);
    expect(h.session.getState().problems).not.toContain('offline');
  });

  it('reports camera problems and returns to Off', async () => {
    const blocked = harness({
      camera: async () =>
        Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })),
    });
    await blocked.session.turnOn();
    expect(phaseOf(blocked.session.getState())).toBe('off');
    expect(blocked.session.getState()).toMatchObject({
      problems: ['cameraBlocked'],
      cameraProblem: 'blocked',
    });

    const busy = harness({
      camera: async () =>
        Promise.reject(Object.assign(new Error('x'), { name: 'NotReadableError' })),
    });
    await busy.session.turnOn();
    expect(busy.session.getState().cameraProblem).toBe('busy');
  });

  it('releases the camera if hand tracking cannot start', async () => {
    const h = harness({ trackerStart: async () => Promise.reject(new Error('wasm failed')) });
    await h.session.turnOn();
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.session.getState()).toMatchObject({
      on: false,
      problems: ['cameraBlocked'],
      cameraProblem: 'unknown',
    });
  });

  it('turning off stops the camera, tracker and queue, and drops in-flight results', async () => {
    let release!: (v: unknown) => void;
    const h = harness({ recognize: () => new Promise((r) => (release = r)) });
    await h.session.turnOn();
    for (const f of makeFrames(ONE_SIGN)) await h.session.tick(f);
    await flush();
    expect(h.session.getState().inFlight).toBe(1);

    h.session.turnOff();
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.tracker.stop).toHaveBeenCalled();
    expect(h.recorder.disarm).toHaveBeenCalled();
    release({ ok: true, sign: 'hello', confidence: 0.9, alternatives: [], latencyMs: 1 });
    await flush();
    expect(h.session.getState().chips).toEqual([]);
    expect(phaseOf(h.session.getState())).toBe('off');
  });

  it('shows low light after two dark readings and clears it on a bright one', async () => {
    let lum = 20;
    const h = harness({ luminance: () => lum });
    h.session.attachVideo({} as HTMLVideoElement);
    await h.session.turnOn();
    const at = (t: number): LandmarkFrame => ({ t, hands: [makeHand()] });
    await h.session.tick(at(0));
    expect(h.session.getState().problems).not.toContain('lowLight'); // one reading is not enough
    await h.session.tick(at(600));
    expect(h.session.getState().problems).toContain('lowLight');
    lum = 150;
    await h.session.tick(at(1200));
    expect(h.session.getState().problems).not.toContain('lowLight');
  });

  it('flags hands out of frame after a few frames at the edge', async () => {
    const h = harness();
    await h.session.turnOn();
    for (let i = 0; i < 4; i++) await h.session.tick({ t: i * 66, hands: [makeHand(0.995, 0.6)] });
    expect(h.session.getState().problems).toContain('handsOut');
    for (let i = 4; i < 8; i++) await h.session.tick({ t: i * 66, hands: [makeHand(0.5, 0.6)] });
    expect(h.session.getState().problems).not.toContain('handsOut');
  });

  it('emits a pause event after the signer lowers their hands', async () => {
    const h = harness();
    const onPause = vi.fn();
    h.session.onPause(onPause);
    await h.session.turnOn();
    await h.feed([...ONE_SIGN, { kind: 'none', ms: 2500 }]);
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});

describe('AudionSession: compose and speak', () => {
  const sentSpeak = (h: ReturnType<typeof harness>) =>
    h.sent.filter((r) => (r as { type: string }).type === 'api/speak');
  const signAndPause: Segment[] = [...ONE_SIGN, { kind: 'none', ms: 2200 }];

  it('auto-speak: after a pause the signs become a sentence that is spoken into the call', async () => {
    const h = harness();
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    const compose = h.sent.find((r) => (r as { type: string }).type === 'api/compose') as {
      signs: string[];
    };
    expect(compose.signs).toEqual(['hello']);
    expect(sentSpeak(h)[0]).toMatchObject({
      text: 'Hello, please wait.',
      voiceId: 'aria',
      speed: 1,
    });
    expect(h.voice.spoken).toHaveLength(1);
    expect(new TextDecoder().decode(h.voice.spoken[0])).toBe('RIFF-audio'); // the API's audio, handed to the call
    const s = h.session.getState();
    expect(s.caption).toBe('Hello, please wait.');
    expect(s.chips).toEqual([]);
    expect(s.sentence).toBeNull();
    expect(h.sent.find((r) => (r as { type: string }).type === 'transcript/add')).toMatchObject({
      text: 'Hello, please wait.',
    });
  });

  it('confirm-first: stops at the sentence; Speak button speaks it; Cancel drops it', async () => {
    const h = harness();
    h.settings.speakMode = 'confirm';
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    expect(h.session.getState().sentence).toBe('Hello, please wait.');
    expect(h.voice.spoken).toHaveLength(0);

    await h.session.speakNow();
    expect(h.voice.spoken).toHaveLength(1);
    expect(h.session.getState().sentence).toBeNull();

    await h.feed(signAndPause);
    await flush();
    expect(h.session.getState().sentence).not.toBeNull();
    h.session.clear();
    expect(h.session.getState()).toMatchObject({ sentence: null, chips: [] });
    expect(h.voice.spoken).toHaveLength(1); // nothing more was spoken
  });

  it('the Speak button composes and speaks the signs so far without waiting for a pause', async () => {
    const h = harness();
    h.settings.speakMode = 'confirm';
    await h.session.turnOn();
    await h.feed(ONE_SIGN); // hands still up: no pause yet
    expect(h.sent.some((r) => (r as { type: string }).type === 'api/compose')).toBe(false);
    await h.session.speakNow();
    expect(h.voice.spoken).toHaveLength(1);
  });

  it('waits for a low-confidence sign to be confirmed before composing', async () => {
    const h = harness({
      recognize: () => ({
        ok: true,
        sign: 'tomorrow',
        confidence: 0.3,
        alternatives: [],
        latencyMs: 1,
      }),
    });
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    expect(h.sent.some((r) => (r as { type: string }).type === 'api/compose')).toBe(false);
    expect(h.session.getState().chips[0]!.state).toBe('lowConfidence');

    h.session.confirmYes();
    await flush();
    await flush();
    expect(h.sent.some((r) => (r as { type: string }).type === 'api/compose')).toBe(true);
    expect(h.voice.spoken).toHaveLength(1);
  });

  it('waits for clips still being recognised, then composes them together', async () => {
    let release!: (v: unknown) => void;
    const signs = ['hello', 'please'];
    let n = 0;
    const h = harness({
      recognize: () => {
        const sign = signs[n++]!;
        const answer = { ok: true, sign, confidence: 0.9, alternatives: [], latencyMs: 1 };
        return n === 2 ? new Promise((r) => (release = () => r(answer))) : answer;
      },
    });
    await h.session.turnOn();
    const one: Segment[] = [
      { kind: 'move', ms: 1000 },
      { kind: 'still', ms: 700 },
    ];
    await h.feed([{ kind: 'still', ms: 200 }, ...one, ...one, { kind: 'none', ms: 2200 }]);
    expect(h.sent.some((r) => (r as { type: string }).type === 'api/compose')).toBe(false); // second clip not answered yet
    release(undefined);
    await flush();
    await flush();
    await flush();
    const compose = h.sent.find((r) => (r as { type: string }).type === 'api/compose') as {
      signs: string[];
    };
    expect(compose.signs).toEqual(['hello', 'please']);
  });

  it('Audion’s voice switch: captions and transcript, but nothing sent to the call', async () => {
    const h = harness();
    h.session.setVoiceMuted(true);
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    expect(sentSpeak(h)).toHaveLength(0);
    expect(h.voice.spoken).toHaveLength(0);
    expect(h.session.getState().caption).toBe('Hello, please wait.');
    expect(h.voice.configs.at(-1)).toEqual({ enabled: true, voiceMuted: true });
  });

  it('turning On enables the voice channel; turning Off restores the plain microphone', async () => {
    const h = harness();
    await h.session.turnOn();
    expect(h.voice.configs.at(-1)).toEqual({ enabled: true, voiceMuted: false });
    h.session.turnOff();
    expect(h.voice.configs.at(-1)).toEqual({ enabled: false, voiceMuted: false });
  });

  it('tells the signer to reload when Meet never gave Audion the microphone, and keeps the sentence', async () => {
    const h = harness();
    h.voice.result = 'no-channel';
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    const s = h.session.getState();
    expect(s.problems).toContain('voiceUnavailable');
    expect(s.sentence).toBe('Hello, please wait.');
    h.voice.result = 'done';
    await h.session.speakNow();
    expect(h.session.getState()).toMatchObject({ sentence: null });
    expect(h.session.getState().problems).not.toContain('voiceUnavailable');
  });

  it('reports a failed compose or speak as Reconnecting and allows retry', async () => {
    let fail = true;
    const h = harness({
      compose: () =>
        fail ? { ok: false, error: { code: 'NETWORK', message: 'x', retryable: true } } : undefined,
    });
    h.settings.speakMode = 'confirm';
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    expect(h.session.getState().problems).toContain('offline');
    expect(h.session.getState().chips).toHaveLength(1);
    fail = false;
    await h.session.speakNow();
    expect(h.session.getState().problems).not.toContain('offline');
  });

  it('surfaces Meet’s mute state from the voice channel', async () => {
    const h = harness();
    await h.session.turnOn();
    h.voice.emitChannel({ hasChannel: true, micMuted: true });
    expect(h.session.getState().micMuted).toBe(true);
    h.voice.emitChannel({ hasChannel: true, micMuted: false });
    expect(h.session.getState().micMuted).toBe(false);
  });

  it('posts to Meet chat only when the setting is on, and says so if it could not', async () => {
    const h = harness();
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    expect(h.chat).not.toHaveBeenCalled(); // default OFF

    h.settings.postToChat = true;
    h.chat.mockResolvedValueOnce('draft');
    await h.feed(signAndPause);
    await flush();
    await flush();
    expect(h.chat).toHaveBeenCalledWith('Hello, please wait.');
    expect(h.session.getState().notice).toMatch(/draft/);
  });

  it('keeps the sign labels (never text or video) behind each spoken sentence for feedback', async () => {
    const h = harness();
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    expect(h.session.getSignLog()).toEqual(['hello']);
    h.session.clearSignLog();
    expect(h.session.getSignLog()).toEqual([]);
  });

  it('clears the caption after a few seconds', async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.session.turnOn();
    for (const f of makeFrames(signAndPause)) await h.session.tick(f);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.session.getState().caption).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5100);
    expect(h.session.getState().caption).toBeNull();
  });
});
