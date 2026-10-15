import { vi } from 'vitest';
import type { SpeakResult } from '../lib/voiceProtocol';
import type { VoiceChannel } from '../lib/voiceBridge';
import { AudionSession, type SessionDeps } from '../panel/session';

export function fakeVoice(result: SpeakResult = 'done') {
  const deliveryCbs = new Set<(sent: boolean | null) => void>();
  const channelCbs = new Set<(s: { hasChannel: boolean; micMuted: boolean }) => void>();
  const voice = {
    result,
    spoken: [] as Uint8Array[],
    configs: [] as Array<{ enabled: boolean; voiceMuted: boolean }>,
    speak: vi.fn(async (b: Uint8Array) => {
      voice.spoken.push(b);
      return voice.result;
    }),
    configure: vi.fn((c: { enabled: boolean; voiceMuted: boolean }) => void voice.configs.push(c)),
    onChannel: (cb: (s: { hasChannel: boolean; micMuted: boolean }) => void) => {
      channelCbs.add(cb);
      return () => channelCbs.delete(cb);
    },
    emitChannel: (s: { hasChannel: boolean; micMuted: boolean }) =>
      channelCbs.forEach((cb) => cb(s)),
    onDelivery: (cb: (sent: boolean | null) => void) => {
      deliveryCbs.add(cb);
      return () => deliveryCbs.delete(cb);
    },
    emitDelivery: (sent: boolean | null) => deliveryCbs.forEach((cb) => cb(sent)),
    probe: async () => ({ hasChannel: true, micMuted: false, peak: 0 }),
    dispose: () => {},
  };
  return voice satisfies VoiceChannel & Record<string, unknown>;
}

export interface FakeEnv {
  session: AudionSession;
  deps: SessionDeps;
  track: { stop: ReturnType<typeof vi.fn> };
  voice: ReturnType<typeof fakeVoice>;
  chat: ReturnType<typeof vi.fn>;
  sent: Array<{ type: string } & Record<string, unknown>>;
}

/** A session wired to fakes: scripted camera, tracker, recorder, API replies, voice channel and chat. */
export function fakeSession(
  overrides: Partial<SessionDeps> = {},
  api: (req: { type: string } & Record<string, unknown>) => unknown = () => undefined,
): FakeEnv {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const sent: FakeEnv['sent'] = [];
  const voice = fakeVoice();
  const chat = vi.fn(async () => 'sent' as const);
  const deps: SessionDeps = {
    tracker: { start: async () => {}, detect: async () => null, stop: vi.fn() },
    getCamera: async () => stream,
    createRecorder: () => ({
      arm() {},
      disarm() {},
      signStarted() {},
      finish: async () => ({
        blob: new Blob(['clip-bytes']),
        mime: 'video/webm',
        durationMs: 1400,
      }),
    }),
    send: vi.fn(async (req) => {
      const r = req as FakeEnv['sent'][number];
      sent.push(r);
      const custom = api(r);
      if (custom !== undefined) return custom;
      switch (r.type) {
        case 'api/health':
          return { ok: true, mode: 'mock', confidenceThreshold: 0.5 };
        case 'api/recognize':
          return { ok: true, sign: 'hello', confidence: 0.9, alternatives: [], latencyMs: 1 };
        case 'api/compose':
          return { ok: true, sentence: 'Hello, please wait.' };
        case 'api/speak':
          return { ok: true, audioBase64: btoa('RIFF-fake-audio'), contentType: 'audio/wav' };
        default:
          return { ok: true };
      }
    }),
    settings: () => ({
      holdTimeMs: 400,
      pauseMs: 1500,
      speakMode: 'auto',
      voiceId: 'aria',
      speed: 1,
      postToChat: false,
      monitorVoice: true,
    }),
    voice,
    playLocal: vi.fn(async () => {}),
    chat,
    luminance: () => 120,
    now: () => 0,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    ...overrides,
  };
  return { session: new AudionSession(deps), deps, track, voice, chat, sent };
}
