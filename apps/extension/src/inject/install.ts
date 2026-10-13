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
  let current: Mixer | null = null;
  let enabled = false;
  let voiceMuted = false;
  let micMuted = false;

  const post = (msg: FromInject) => win.postMessage(msg, win.location.origin);
  const announce = () =>
    post({ source: INJECT_SOURCE, type: 'channel', hasChannel: current !== null, micMuted });

  md.getUserMedia = async (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
    if (!constraints?.audio) return original(constraints);

    let real: MediaStream | null = null;
    try {
      real = await original(constraints);
    } catch (e) {
      // No microphone at all (common for signers): still give Meet an audio track that carries Audion's voice.
      if ((e as { name?: string }).name !== 'NotFoundError') throw e;
      real = constraints.video ? await original({ ...constraints, audio: false }) : null;
    }

    const ctx = new win.AudioContext();
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
          if (current === mixer) {
            micMuted = !v;
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
      if (current === mixer) {
        current = null;
        micMuted = false;
        announce();
      }
    };

    const old = current;
    current = mixer;
    micMuted = false;
    if (old && old !== mixer) old.configure({ enabled: false }); // the previous channel stops speaking; Meet closes it
    announce();
    return new win.MediaStream([...(real?.getVideoTracks() ?? []), audioTrack]);
  };

  const onMessage = async (e: MessageEvent) => {
    if (!isSameWindowMessage(e, win) || !isToInject(e.data)) return;
    const msg = e.data;
    if (msg.type === 'config') {
      enabled = msg.enabled;
      voiceMuted = msg.voiceMuted;
      current?.configure({ enabled, voiceMuted });
    } else if (msg.type === 'speak') {
      let result: SpeakResult;
      if (!current) result = 'no-channel';
      else {
        try {
          result = await current.play(msg.audio);
        } catch {
          result = 'error';
        }
      }
      post({ source: INJECT_SOURCE, type: 'speak-result', id: msg.id, result });
    } else if (msg.type === 'probe') {
      post({
        source: INJECT_SOURCE,
        type: 'probe-result',
        id: msg.id,
        hasChannel: current !== null,
        micMuted,
        peak: current?.peak() ?? 0,
      });
    }
  };
  win.addEventListener('message', onMessage);

  post({ source: INJECT_SOURCE, type: 'hello' });
  /** For tests: detach the message listener. (The getUserMedia patch stays, like in a real page.) */
  return () => win.removeEventListener('message', onMessage);
}
