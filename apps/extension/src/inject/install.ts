import { Mixer, type MixerContext } from '../lib/audioMixer';
import {
  INJECT_SOURCE,
  isSameWindowMessage,
  isToInject,
  type FromInject,
  type SpeakResult,
} from '../lib/voiceProtocol';

type Win = Window &
  typeof globalThis & { AudioContext: new () => MixerContext & { state: string } };

const PATCHED = Symbol.for('audion.patched');

const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * Chrome starts an AudioContext "suspended" when the page has not had a click yet, and Meet can ask for the microphone
 * at page load. A suspended context sends silence: the person's own voice would vanish from the call and Ola's voice
 * could not play. So try to resume now, and again on the first click or key press, until it is running.
 */
function keepRunning(ctx: MixerContext, win: Window): void {
  if (ctx.state !== 'suspended') return;
  const stop = () => GESTURES.forEach((e) => win.removeEventListener(e, resume, true));
  function resume() {
    void Promise.resolve(ctx.resume())
      .then(() => ctx.state !== 'suspended' && stop())
      .catch(() => {});
  }
  GESTURES.forEach((e) => win.addEventListener(e, resume, true));
  resume();
}

type AnyFn = (this: unknown, ...args: unknown[]) => unknown;

/** Run `after` with the receiver and result of every call to `obj[name]`, leaving the call itself untouched. */
function watchCall(
  obj: object | undefined,
  name: string,
  after: (self: unknown, result: unknown) => void,
): void {
  const rec = obj as Record<string, unknown> | undefined;
  const orig = rec?.[name];
  if (typeof orig !== 'function') return;
  rec![name] = function (this: unknown, ...args: unknown[]) {
    const result = (orig as AnyFn).apply(this, args);
    try {
      after(this, result);
    } catch {
      /* watching must never break the page */
    }
    return result;
  };
}

/** Energy (arbitrary units, only ever increasing) of the audio the call is sending, summed over its audio senders. */
type EnergyReader = () => Promise<number | null>;

/** More energy than a quiet room makes in a second, less than a sentence of speech makes. */
const SENT_ENERGY = 0.001;

/**
 * Remember the call's outgoing audio connections (RTCRtpSender) as Meet creates and updates them, and read how much
 * audio energy they are carrying. That lets us check, while Ola speaks, that the voice really enters the call, however
 * Meet wires the microphone (the same track, a clone, or through its own noise-cancelling pipeline).
 */
function watchSenders(win: Win): EnergyReader {
  const senders = new Set<WeakRef<RTCRtpSender>>();
  const remember = (s: unknown) => {
    if (s && typeof (s as RTCRtpSender).getStats === 'function')
      senders.add(new WeakRef(s as RTCRtpSender));
  };
  const pc = (win as unknown as { RTCPeerConnection?: { prototype: object } }).RTCPeerConnection
    ?.prototype;
  const sender = (win as unknown as { RTCRtpSender?: { prototype: object } }).RTCRtpSender
    ?.prototype;
  watchCall(pc, 'addTrack', (_self, s) => remember(s));
  watchCall(pc, 'addTransceiver', (_self, t) =>
    remember((t as RTCRtpTransceiver | undefined)?.sender),
  );
  watchCall(sender, 'replaceTrack', (self) => remember(self));

  return async () => {
    let total = 0;
    let any = false;
    for (const ref of [...senders]) {
      const s = ref.deref();
      if (!s) {
        senders.delete(ref);
        continue;
      }
      if (s.track && s.track.kind !== 'audio') continue;
      try {
        (await s.getStats()).forEach((r: Record<string, unknown>) => {
          if (
            r.type === 'media-source' &&
            r.kind === 'audio' &&
            typeof r.totalAudioEnergy === 'number'
          ) {
            total += r.totalAudioEnergy;
            any = true;
          }
        });
      } catch {
        /* a closed connection has no statistics */
      }
    }
    return any ? total : null;
  };
}

/**
 * Runs in the page's own (MAIN) world at document_start. Wraps getUserMedia so the audio track Meet receives
 * comes from our mixer: the real microphone plus Audion's voice. With Audion Off the wrapper is a pure
 * pass-through of the mic, so the call behaves as if Audion were not installed.
 *
 * Limits: only streams requested after this script runs are wrapped (reload the Meet tab once after
 * installing), and Meet's own mute switch silences the whole track, Audion's voice included.
 */
export function installInject(win: Win = window as Win): () => void {
  const md = win.navigator.mediaDevices;
  if (!md || (md as unknown as Record<symbol, unknown>)[PATCHED]) return () => {};
  (md as unknown as Record<symbol, unknown>)[PATCHED] = true;

  const original = md.getUserMedia.bind(md);
  /**
   * Every microphone stream Meet is holding (it can ask more than once: a preview before joining, then the call).
   * Ola speaks into all of them: we cannot tell which one Meet sends, and a stream Meet is not sending is harmless.
   */
  const live = new Set<Mixer>();
  const muted = new Map<Mixer, boolean>(); // Meet's own mute (track.enabled = false), per stream
  let enabled = false;
  let voiceMuted = false;
  const energy = watchSenders(win);

  const micMuted = () => live.size > 0 && [...live].every((m) => muted.get(m) === true);
  const post = (msg: FromInject) => win.postMessage(msg, win.location.origin);
  const announce = () =>
    post({
      source: INJECT_SOURCE,
      type: 'channel',
      hasChannel: live.size > 0,
      micMuted: micMuted(),
    });

  md.getUserMedia = async (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
    if (!constraints?.audio) return original(constraints);

    let real: MediaStream | null = null;
    let noMicError: unknown;
    try {
      real = await original(constraints);
    } catch (e) {
      // No microphone at all (common for signers): still give Meet an audio track that carries Audion's voice.
      if ((e as { name?: string }).name !== 'NotFoundError') throw e;
      noMicError = e;
      real = constraints.video ? await original({ ...constraints, audio: false }) : null;
    }

    // Whatever goes wrong while building our channel, the call must still work: fall back to the plain stream.
    let ctx: MixerContext | undefined;
    try {
      ctx = new win.AudioContext();
      keepRunning(ctx, win);
      const mixer = new Mixer(ctx, real);
      mixer.configure({ enabled, voiceMuted });
      const audioTrack = mixer.stream.getAudioTracks()[0]!;
      const realAudio = real?.getAudioTracks()[0];

      // Mirror the real mic's identity so Meet's device picker keeps working.
      if (realAudio) {
        Object.defineProperty(audioTrack, 'label', { get: () => realAudio.label });
        audioTrack.getSettings = () => realAudio.getSettings();
      }

      // Meet mutes by setting track.enabled = false. Let that happen, but remember it: while muted, nobody
      // can hear Audion either, and the panel tells the signer.
      const proto = Object.getPrototypeOf(audioTrack) as MediaStreamTrack;
      const enabledDesc =
        Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'enabled') ??
        Object.getOwnPropertyDescriptor(proto, 'enabled');
      if (enabledDesc?.get && enabledDesc.set) {
        Object.defineProperty(audioTrack, 'enabled', {
          get: () => enabledDesc.get!.call(audioTrack),
          set: (v: boolean) => {
            enabledDesc.set!.call(audioTrack, v);
            if (live.has(mixer)) {
              muted.set(mixer, !v);
              announce();
            }
          },
        });
      }

      // When Meet stops our track (mic off, leaving, device change) release the real microphone too,
      // so the browser's recording indicator goes away.
      const stopOriginal = audioTrack.stop.bind(audioTrack);
      audioTrack.stop = () => {
        stopOriginal();
        real?.getTracks().forEach((t) => t.stop());
        mixer.dispose();
        if (live.delete(mixer)) {
          muted.delete(mixer);
          announce();
        }
      };

      live.add(mixer);
      muted.set(mixer, false);
      announce();
      return new win.MediaStream([...(real?.getVideoTracks() ?? []), audioTrack]);
    } catch (e) {
      console.warn(
        'Audion: voice channel unavailable, passing the microphone through unchanged.',
        e,
      );
      void ctx?.close().catch(() => {});
      if (real) return real;
      throw noMicError ?? e;
    }
  };

  const onMessage = async (e: MessageEvent) => {
    if (!isSameWindowMessage(e, win) || !isToInject(e.data)) return;
    const msg = e.data;
    if (msg.type === 'config') {
      enabled = msg.enabled;
      voiceMuted = msg.voiceMuted;
      for (const m of live) m.configure({ enabled, voiceMuted });
    } else if (msg.type === 'speak') {
      const targets = [...live];
      let result: SpeakResult;
      let sent: boolean | null = null;
      if (targets.length === 0) result = 'no-channel';
      else {
        const before = await energy();
        // Same voice into every stream; the local copy on the speakers only once.
        const results = await Promise.all(
          targets.map(async (m, i): Promise<SpeakResult> => {
            try {
              return await m.play(msg.audio.slice(0), { monitor: msg.monitor === true && i === 0 });
            } catch {
              return 'error';
            }
          }),
        );
        result = results.includes('done')
          ? 'done'
          : (results.find((r) => r !== 'error') ?? 'error');
        if (result === 'done') {
          const after = await energy();
          sent = before === null || after === null ? null : after - before > SENT_ENERGY;
        }
      }
      post({ source: INJECT_SOURCE, type: 'speak-result', id: msg.id, result, sent });
    } else if (msg.type === 'probe') {
      post({
        source: INJECT_SOURCE,
        type: 'probe-result',
        id: msg.id,
        hasChannel: live.size > 0,
        micMuted: micMuted(),
        peak: Math.max(0, ...[...live].map((m) => m.peak())),
      });
    }
  };
  win.addEventListener('message', onMessage);

  post({ source: INJECT_SOURCE, type: 'hello' });
  /** For tests: detach the message listener. (The getUserMedia patch stays, like in a real page.) */
  return () => win.removeEventListener('message', onMessage);
}
