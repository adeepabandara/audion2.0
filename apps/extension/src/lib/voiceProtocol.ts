/**
 * postMessage protocol between the content script (isolated world) and the MAIN-world inject script.
 * Both sides require: same window, same origin, and the matching `source` tag. Page scripts could still send
 * these messages, but the worst they can do is play audio the user could not otherwise make Audion say.
 */
export const CONTENT_SOURCE = 'audion-content';
export const INJECT_SOURCE = 'audion-inject';

export type ToInject =
  | { source: typeof CONTENT_SOURCE; type: 'config'; enabled: boolean; voiceMuted: boolean }
  | {
      source: typeof CONTENT_SOURCE;
      type: 'speak';
      id: number;
      audio: ArrayBuffer;
      /** Also play it on this device's speakers (the signer hearing their own voice). */
      monitor?: boolean;
    }
  | { source: typeof CONTENT_SOURCE; type: 'probe'; id: number };

export type SpeakResult = 'done' | 'no-channel' | 'disabled' | 'muted' | 'error';

export type FromInject =
  | { source: typeof INJECT_SOURCE; type: 'hello' }
  | { source: typeof INJECT_SOURCE; type: 'channel'; hasChannel: boolean; micMuted: boolean }
  | {
      source: typeof INJECT_SOURCE;
      type: 'speak-result';
      id: number;
      result: SpeakResult;
      /**
       * Did the call's outgoing audio actually carry the voice? Measured from the call's own audio statistics while
       * the sentence played. null = could not tell (no call connection found, or no statistics).
       */
      sent?: boolean | null;
    }
  | {
      source: typeof INJECT_SOURCE;
      type: 'probe-result';
      id: number;
      hasChannel: boolean;
      micMuted: boolean;
      peak: number;
    };

const hasSource = (d: unknown, source: string) =>
  typeof d === 'object' && d !== null && (d as { source?: unknown }).source === source;

export const isToInject = (d: unknown): d is ToInject => hasSource(d, CONTENT_SOURCE);
export const isFromInject = (d: unknown): d is FromInject => hasSource(d, INJECT_SOURCE);

/** True if the event came from this very window and origin (not an iframe, not another site). */
export const isSameWindowMessage = (e: MessageEvent, win: Window): boolean =>
  e.source === win && e.origin === win.location.origin;
