import type { LanguageCode } from '@audion/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LandmarkFrame } from '../lib/landmarks';
import { makeFrames, makeHand, type Segment } from '../testing/fixtures';
import { pendingChip, phaseOf, viewOf } from './machine';
import { fakeVoice } from '../testing/fakeSession';
import type { ContextUpdate, MeetingContextLike } from './meetingContext';
import { AudionSession, CONFIRM_UNSURE_SIGNS, type SessionDeps, type TraceEvent } from './session';

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
    translate?: (r: unknown) => unknown;
    /** The on-device classifier's answer; when given the tracker offers `classify`. */
    classify?: () => { sign: string; confidence: number; threshold: number } | null;
    /** A meeting-context tracker; when given the session can follow the meeting. */
    context?: MeetingContextLike;
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
  const playLocal = vi.fn(async (_audio: Uint8Array) => {});
  const settingsRef = {
    current: {
      holdTimeMs: 400,
      pauseMs: 1500,
      speakMode: 'auto' as 'auto' | 'confirm',
      voiceId: 'aria' as const,
      speed: 1,
      postToChat: false,
      monitorVoice: true,
      fastSigns: true,
      // These tests exercise the optional cloud double-check; the device-only mode has its own tests below.
      cloudCheck: true,
      meetingContext: false,
      language: 'en' as LanguageCode,
    },
  };
  let recognizeCalls = 0;
  const sent: unknown[] = [];
  const tracker = {
    start: vi.fn(opts.trackerStart ?? (async () => {})),
    detect: vi.fn(),
    stop: vi.fn(),
    ...(opts.classify ? { classify: vi.fn(async () => opts.classify!()) } : {}),
  };
  const deps: SessionDeps = {
    tracker,
    getCamera: opts.camera ?? (async () => stream),
    createRecorder: () => recorder,
    send: vi.fn(async (req) => {
      sent.push(req);
      if (req.type === 'api/health')
        return { ok: true, mode: 'mock', confidenceThreshold: 0.5, modelId: 'mock' };
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
      if (req.type === 'api/translate')
        return opts.translate?.(req) ?? { ok: true, text: 'Hola, por favor espera.' };
      if (req.type === 'transcript/add') return { ok: true };
      return (
        opts.recognize ??
        (() => ({ ok: true, sign: 'hello', confidence: 0.9, alternatives: [], latencyMs: 1 }))
      )(++recognizeCalls);
    }),
    settings: () => settingsRef.current,
    ...(opts.context ? { context: opts.context } : {}),
    voice,
    playLocal,
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
    playLocal,
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
  it('accepts an unsure sign as it is while "Did you mean" is switched off', async () => {
    expect(CONFIRM_UNSURE_SIGNS).toBe(false);
    const h = harness({
      recognize: () => ({
        ok: true,
        sign: 'hello',
        confidence: 0.1,
        alternatives: [],
        latencyMs: 1,
      }),
    });
    await h.session.turnOn();
    await h.feed(ONE_SIGN);
    const s = h.session.getState();
    expect(s.chips).toMatchObject([{ sign: 'hello', state: 'normal' }]);
    expect(pendingChip(s)).toBeUndefined();
  });

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

  it('learns the recognition model from the health check and from each answer', async () => {
    const h = harness({
      recognize: () => ({
        ok: true,
        sign: 'hello',
        confidence: 0.9,
        alternatives: [],
        latencyMs: 1,
        modelId: 'tuned:42',
      }),
    });
    await h.session.turnOn();
    await flush();
    expect(h.session.getState().modelId).toBe('mock'); // from /healthz
    await h.feed(ONE_SIGN);
    expect(h.session.getState().modelId).toBe('tuned:42'); // from the answer
  });

  it('tells the signer when the server’s daily call cap is reached, and does not retry', async () => {
    const h = harness({
      recognize: () => ({
        ok: false,
        error: { code: 'DAILY_CAP_REACHED', message: 'cap', retryable: false },
      }),
    });
    await h.session.turnOn();
    await h.feed(ONE_SIGN);
    const s = h.session.getState();
    expect(s.notice).toMatch(/Daily limit reached/);
    expect(s.chips).toEqual([]);
    expect(s.problems).toContain('notRecognised');
    expect(s.problems).not.toContain('offline'); // a cap is not a connection problem
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

  it.runIf(CONFIRM_UNSURE_SIGNS)(
    'low-confidence answers wait for confirmation; Yes confirms, Try again removes',
    async () => {
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
    },
  );

  it.runIf(CONFIRM_UNSURE_SIGNS)('uses the confidence threshold the API reports', async () => {
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
    expect(viewOf(h.session.getState()).hint).toBe('Sign again, slowly.');
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

  it('follows the delivery reports while on, and stops listening when switched off', async () => {
    const h = harness();
    await h.session.turnOn();
    h.voice.emitDelivery(false);
    expect(h.session.getState().delivered).toBe(false);
    h.voice.emitDelivery(true);
    expect(h.session.getState().delivered).toBe(true);
    h.session.turnOff();
    h.voice.emitDelivery(false);
    expect(h.session.getState().delivered).toBeNull(); // off: nothing listens any more
  });

  it('learns on switch-on whether the call has a voice channel, and follows it as Meet changes the mic', async () => {
    const connected = harness();
    await connected.session.turnOn();
    await flush();
    expect(connected.session.getState().callAudio).toBe('connected');
    connected.voice.emitChannel({ hasChannel: false, micMuted: false }); // Meet stopped the mic track
    expect(connected.session.getState().callAudio).toBe('none');
    connected.voice.emitChannel({ hasChannel: true, micMuted: true });
    expect(connected.session.getState()).toMatchObject({ callAudio: 'connected', micMuted: true });

    const none = harness();
    none.voice.probe = async () => ({ hasChannel: false, micMuted: false, peak: 0 });
    await none.session.turnOn();
    await flush();
    expect(none.session.getState().callAudio).toBe('none');
  });

  it('asks the call channel to also play Ola’s voice locally, following the monitor setting', async () => {
    const on = harness();
    await on.session.turnOn();
    await on.feed(signAndPause);
    await flush();
    expect(on.voice.speak).toHaveBeenCalledWith(expect.anything(), { monitor: true });

    const off = harness();
    off.settings.monitorVoice = false;
    await off.session.turnOn();
    await off.feed(signAndPause);
    await flush();
    expect(off.voice.speak).toHaveBeenCalledWith(expect.anything(), { monitor: false });
  });

  it('with no call channel (e.g. Meet is muted) the signer still hears the sentence locally', async () => {
    const h = harness();
    h.voice.result = 'no-channel';
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    expect(h.playLocal).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(h.playLocal.mock.calls[0]![0])).toBe('RIFF-audio');
    // The call still did not get it, and the panel still says the voice is not connected to the call.
    expect(h.session.getState().problems).toContain('voiceUnavailable');
  });

  it('does not play locally when the setting is off, or when the call channel took the audio', async () => {
    const off = harness();
    off.voice.result = 'no-channel';
    off.settings.monitorVoice = false;
    await off.session.turnOn();
    await off.feed(signAndPause);
    await flush();
    expect(off.playLocal).not.toHaveBeenCalled();

    const ok = harness(); // channel works: the mixer makes the local copy itself, so no second one
    await ok.session.turnOn();
    await ok.feed(signAndPause);
    await flush();
    expect(ok.playLocal).not.toHaveBeenCalled();
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

  it.runIf(CONFIRM_UNSURE_SIGNS)(
    'waits for a low-confidence sign to be confirmed before composing',
    async () => {
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
    },
  );

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

  describe('fast signs (on-device classifier, cloud checks)', () => {
    const device =
      (sign: string, confidence = 0.95) =>
      () => ({ sign, confidence, threshold: 0.8 });
    const cloud = (sign: string) => () => ({
      ok: true,
      sign,
      confidence: 0.9,
      alternatives: [],
      latencyMs: 1,
    });

    it('a confident device answer becomes the chip, and the cloud agreeing just confirms it', async () => {
      const h = harness({ classify: device('hello'), recognize: cloud('hello') });
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      const [chip] = h.session.getState().chips;
      expect(chip).toMatchObject({ sign: 'hello', source: 'device', checking: false });
      expect(chip?.corrected).toBeUndefined();
      expect(h.session.getState().inFlight).toBe(0);
      // the clip still went to the cloud, as a check
      expect(h.sent.filter((r) => (r as { type: string }).type === 'api/recognize')).toHaveLength(
        1,
      );
    });

    it('shows the device answer before the cloud has replied', async () => {
      let release: (v: unknown) => void = () => {};
      const slow = new Promise((r) => (release = r));
      const h = harness({
        classify: device('yes'),
        recognize: (() => slow) as unknown as () => unknown,
      });
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      expect(h.session.getState().chips).toMatchObject([{ sign: 'yes', checking: true }]);
      release(cloud('yes')());
      await new Promise((r) => setTimeout(r, 0));
      await flush();
      expect(h.session.getState().chips[0]?.checking).toBe(false);
    });

    it('corrects the chip, and says so, when the cloud disagrees', async () => {
      const h = harness({ classify: device('yes'), recognize: cloud('no') });
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      const s = h.session.getState();
      expect(s.chips).toMatchObject([{ sign: 'no', checking: false, corrected: { was: 'yes' } }]);
      expect(s.notice).toMatch(/Changed .yes. to .no./);
    });

    it('keeps the device answer when the cloud cannot tell', async () => {
      const h = harness({ classify: device('yes'), recognize: cloud('unknown') });
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      expect(h.session.getState().chips).toMatchObject([{ sign: 'yes', checking: false }]);
    });

    it('waits for the cloud when the device is not confident enough', async () => {
      const h = harness({ classify: device('yes', 0.5), recognize: cloud('hello') });
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      const [chip] = h.session.getState().chips;
      expect(chip).toMatchObject({ sign: 'hello' });
      expect(chip?.source).toBeUndefined();
    });

    it('does not use the device when the setting is off', async () => {
      const h = harness({ classify: device('yes'), recognize: cloud('hello') });
      h.settings.fastSigns = false;
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      expect(h.tracker.classify).not.toHaveBeenCalled();
      expect(h.session.getState().chips).toMatchObject([{ sign: 'hello' }]);
    });
  });

  describe('pipeline trace (which step did what)', () => {
    const cloud = (sign: string) => () => ({
      ok: true,
      sign,
      confidence: 0.9,
      alternatives: [],
      latencyMs: 2900,
    });

    it('reports the device answer, then the cloud check, then the sentence and the voice', async () => {
      const h = harness({
        classify: () => ({ sign: 'yes', confidence: 0.95, threshold: 0.8 }),
        recognize: cloud('no'),
        compose: () => ({ ok: true, sentence: 'No.', writer: 'Gemma, on this device' }),
      });
      const events: TraceEvent[] = [];
      h.session.onTrace((e) => events.push(e));
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      await h.session.speakNow();
      await flush();
      expect(events.map((e) => e.kind)).toEqual(['device', 'cloud', 'sentence', 'voice']);
      expect(events[0]).toMatchObject({ kind: 'device', sign: 'yes', confidence: 0.95 });
      expect(events[1]).toMatchObject({
        kind: 'cloud',
        role: 'check',
        sign: 'no',
        deviceSign: 'yes',
        ms: 2900,
      });
      expect(events[2]).toMatchObject({ kind: 'sentence', writer: 'Gemma, on this device' });
      expect(events[3]).toMatchObject({ kind: 'voice', voiceId: 'aria' });
    });

    it('passes on what the model saw (runner-up guesses, frames, hands) so the log can show it', async () => {
      const top = [
        { sign: 'yes', confidence: 0.9 },
        { sign: 'no', confidence: 0.06 },
        { sign: 'hello', confidence: 0.02 },
      ];
      const h = harness({
        classify: () => ({
          sign: 'yes',
          confidence: 0.9,
          threshold: 0.8,
          top,
          frames: 17,
          hands: 2,
        }),
        recognize: cloud('yes'),
      });
      const events: TraceEvent[] = [];
      h.session.onTrace((e) => events.push(e));
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      await flush();
      expect(events[0]).toMatchObject({ kind: 'device', sign: 'yes', top, frames: 17, hands: 2 });
    });

    it('says the device was unsure and the cloud answered', async () => {
      const h = harness({
        classify: () => ({ sign: 'yes', confidence: 0.4, threshold: 0.8 }),
        recognize: cloud('hello'),
      });
      const events: TraceEvent[] = [];
      h.session.onTrace((e) => events.push(e));
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      expect(events.map((e) => e.kind)).toEqual(['device-unsure', 'cloud']);
      expect(events[1]).toMatchObject({ role: 'answer', sign: 'hello' });
    });
  });

  describe('device only (no cloud recognition call)', () => {
    const device = (sign: string, confidence: number) => () => ({
      sign,
      confidence,
      threshold: 0.8,
    });
    const recognizeCalls = (h: ReturnType<typeof harness>) =>
      h.sent.filter((r) => (r as { type: string }).type === 'api/recognize');

    it('names a confident sign on the device and never calls the cloud', async () => {
      const h = harness({ classify: device('yes', 0.95) });
      h.settings.cloudCheck = false;
      const events: TraceEvent[] = [];
      h.session.onTrace((e) => events.push(e));
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      expect(h.session.getState().chips).toMatchObject([
        { sign: 'yes', source: 'device', checking: false },
      ]);
      expect(h.session.getState().inFlight).toBe(0);
      expect(recognizeCalls(h)).toHaveLength(0);
      expect(events.map((e) => e.kind)).toEqual(['device']);
    });

    it('accepts a less sure guess down to 50 %, still with no cloud call', async () => {
      const h = harness({ classify: device('not', 0.62) });
      h.settings.cloudCheck = false;
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      expect(h.session.getState().chips).toMatchObject([{ sign: 'not', checking: false }]);
      expect(recognizeCalls(h)).toHaveLength(0);
    });

    it('asks the signer to sign again below 50 %, with no chip and no cloud call', async () => {
      const h = harness({ classify: device('not', 0.3) });
      h.settings.cloudCheck = false;
      const events: TraceEvent[] = [];
      h.session.onTrace((e) => events.push(e));
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      const s = h.session.getState();
      expect(s.chips).toEqual([]);
      expect(s.problems).toContain('notRecognised');
      expect(s.inFlight).toBe(0);
      expect(recognizeCalls(h)).toHaveLength(0);
      expect(events[0]).toMatchObject({ kind: 'device-unsure', then: 'retry', threshold: 0.5 });
    });

    it('falls back to the cloud when the on-device model gives no answer at all', async () => {
      const h = harness({
        classify: () => null,
        recognize: () => ({
          ok: true,
          sign: 'hello',
          confidence: 0.9,
          alternatives: [],
          latencyMs: 1,
        }),
      });
      h.settings.cloudCheck = false;
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      expect(h.session.getState().chips).toMatchObject([{ sign: 'hello' }]);
      expect(recognizeCalls(h)).toHaveLength(1);
    });
  });

  describe('meeting context (opt-in)', () => {
    /** A stand-in tracker: records start/stop and lets the test push summaries. */
    function fakeContext(initial: string | null = null) {
      let summary = initial;
      let state: ContextUpdate['state'] = 'off';
      let updating = false;
      const changes = new Set<(u: ContextUpdate) => void>();
      const refreshes = new Set<(i: { summary: string; ms: number; chars: number }) => void>();
      const emit = () => changes.forEach((l) => l({ state, summary, updating }));
      return {
        start: vi.fn(() => {
          state = 'waiting';
          emit();
        }),
        stop: vi.fn(() => {
          state = 'off';
          summary = null;
          emit();
        }),
        summary: () => summary,
        onChange: (l: (u: ContextUpdate) => void) => (changes.add(l), () => changes.delete(l)),
        onRefreshed: (l: (i: { summary: string; ms: number; chars: number }) => void) => (
          refreshes.add(l), () => refreshes.delete(l)
        ),
        /** Pretend a summary refresh is in flight (or finished). */
        setUpdating(on: boolean) {
          updating = on;
          emit();
        },
        learn(text: string) {
          summary = text;
          state = 'following';
          emit();
          refreshes.forEach((l) => l({ summary: text, ms: 1200, chars: 300 }));
        },
      } satisfies MeetingContextLike & Record<string, unknown>;
    }
    const composeRequests = (h: ReturnType<typeof harness>) =>
      h.sent.filter((r) => (r as { type: string }).type === 'api/compose') as Array<{
        signs: string[];
        context?: string;
      }>;

    it('starts following when Ola turns on with the setting on, and forgets when it turns off', async () => {
      const context = fakeContext();
      const h = harness({ context });
      h.settings.meetingContext = true;
      await h.session.turnOn();
      expect(context.start).toHaveBeenCalledTimes(1);
      expect(h.session.getState().context).toEqual({
        state: 'waiting',
        summary: null,
        updating: false,
      });
      context.learn('Planning the demo for Friday.');
      expect(h.session.getState().context).toEqual({
        state: 'following',
        summary: 'Planning the demo for Friday.',
        updating: false,
      });
      h.session.turnOff();
      expect(context.stop).toHaveBeenCalled();
      expect(h.session.getState().context).toEqual({
        state: 'off',
        summary: null,
        updating: false,
      });
    });

    it('does not follow the meeting while the setting is off', async () => {
      const context = fakeContext();
      const h = harness({ context });
      await h.session.turnOn();
      expect(context.start).not.toHaveBeenCalled();
      expect(h.session.getState().context.state).toBe('off');
    });

    it('starts and stops when the setting is switched while Ola is on', async () => {
      const context = fakeContext();
      const h = harness({ context });
      await h.session.turnOn();
      h.session.setMeetingContext(true);
      expect(context.start).toHaveBeenCalledTimes(1);
      h.session.setMeetingContext(false);
      expect(context.stop).toHaveBeenCalled();
    });

    it('does not follow while Ola is off, whatever the setting says', () => {
      const context = fakeContext();
      const h = harness({ context });
      h.session.setMeetingContext(true);
      expect(context.start).not.toHaveBeenCalled();
    });

    it('sends the meeting summary with the sentence request, only when the setting is on', async () => {
      const context = fakeContext('Planning the demo for Friday at three.');
      const on = harness({ context });
      on.settings.meetingContext = true;
      await on.session.turnOn();
      await on.feed(ONE_SIGN);
      await on.session.speakNow();
      await flush();
      expect(composeRequests(on)[0]).toMatchObject({
        context: 'Planning the demo for Friday at three.',
      });

      const off = harness({ context: fakeContext('Planning the demo for Friday at three.') });
      await off.session.turnOn();
      await off.feed(ONE_SIGN);
      await off.session.speakNow();
      await flush();
      expect(composeRequests(off)[0]).toBeDefined();
      expect(composeRequests(off)[0]).not.toHaveProperty('context');
    });

    it('sends no context when there is no summary yet', async () => {
      const h = harness({ context: fakeContext(null) });
      h.settings.meetingContext = true;
      await h.session.turnOn();
      await h.feed(ONE_SIGN);
      await h.session.speakNow();
      await flush();
      expect(composeRequests(h)[0]).not.toHaveProperty('context');
    });

    it('passes "a refresh is in flight" on to the panel state', async () => {
      const context = fakeContext('Planning the demo.');
      const h = harness({ context });
      h.settings.meetingContext = true;
      await h.session.turnOn();
      context.setUpdating(true);
      expect(h.session.getState().context.updating).toBe(true);
      context.setUpdating(false);
      expect(h.session.getState().context.updating).toBe(false);
    });

    it('reports each summary refresh in the pipeline trace', async () => {
      const context = fakeContext();
      const h = harness({ context });
      h.settings.meetingContext = true;
      const events: TraceEvent[] = [];
      h.session.onTrace((e) => events.push(e));
      await h.session.turnOn();
      context.learn('Planning the demo.');
      expect(events).toEqual([
        { kind: 'context', summary: 'Planning the demo.', ms: 1200, chars: 300 },
      ]);
    });
  });
});

describe('AudionSession: live translation', () => {
  const signAndPause: Segment[] = [...ONE_SIGN, { kind: 'none', ms: 2200 }];
  const ofType = (h: ReturnType<typeof harness>, type: string) =>
    h.sent.filter((r) => (r as { type: string }).type === type);

  it('does not translate, and speaks without a language, while the language is English', async () => {
    const h = harness();
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    expect(ofType(h, 'api/translate')).toHaveLength(0);
    expect(ofType(h, 'api/speak')[0]).not.toHaveProperty('language');
  });

  it('translates the sentence, shows and speaks the translation in its language', async () => {
    const h = harness();
    h.settings.language = 'es';
    const events: TraceEvent[] = [];
    h.session.onTrace((e) => events.push(e));
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    expect(ofType(h, 'api/translate')[0]).toMatchObject({
      text: 'Hello, please wait.',
      language: 'es',
    });
    expect(ofType(h, 'api/speak')[0]).toMatchObject({
      text: 'Hola, por favor espera.',
      language: 'es',
    });
    expect(h.session.getState().caption).toBe('Hola, por favor espera.');
    expect(events.map((e) => e.kind)).toContain('translate');
    expect(events.find((e) => e.kind === 'translate')).toMatchObject({ language: 'es' });
  });

  it('keeps the English sentence, and says so briefly, when translation fails', async () => {
    const h = harness({
      translate: () => ({
        ok: false,
        error: { code: 'MODEL_UNAVAILABLE', message: 'x', retryable: true },
      }),
    });
    h.settings.language = 'fr';
    await h.session.turnOn();
    await h.feed(signAndPause);
    await flush();
    expect(ofType(h, 'api/speak')[0]).toMatchObject({ text: 'Hello, please wait.' });
    expect(ofType(h, 'api/speak')[0]).not.toHaveProperty('language');
    expect(h.session.getState().notice).toBe('Translation failed. Using English.');
  });
});
