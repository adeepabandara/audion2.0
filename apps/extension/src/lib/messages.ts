import type { ComposeResponse, ErrorCode, RecognizeResponse } from '@audion/shared';

/** Messages from extension pages / content scripts to the service worker. Binary data travels as base64. */
export type Request =
  | { type: 'api/health' }
  | { type: 'ui/openCameraSettings' }
  | { type: 'api/speak'; text: string; voiceId: string; speed: number }
  | { type: 'api/recognize'; clipBase64: string; mime: string; durationMs: number }
  | { type: 'api/compose'; signs: string[]; tone?: 'neutral' | 'polite' };

export interface Failure {
  ok: false;
  error: { code: ErrorCode | 'NETWORK'; message: string; retryable: boolean };
}

export type ResponseFor<R extends Request> = R extends { type: 'ui/openCameraSettings' }
  ? { ok: true }
  : R extends { type: 'api/health' }
    ? { ok: true; mode: 'live' | 'mock'; confidenceThreshold?: number } | Failure
    : R extends { type: 'api/speak' }
      ? { ok: true; audioBase64: string; contentType: string } | Failure
      : R extends { type: 'api/recognize' }
        ? ({ ok: true } & RecognizeResponse) | Failure
        : R extends { type: 'api/compose' }
          ? ({ ok: true } & ComposeResponse) | Failure
          : never;

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000)
    bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Send a typed request to the service worker. A missing worker (plain-browser preview) becomes a NETWORK failure. */
export async function send<R extends Request>(req: R): Promise<ResponseFor<R>> {
  try {
    return (await chrome.runtime.sendMessage(req)) as ResponseFor<R>;
  } catch (e) {
    return {
      ok: false,
      error: { code: 'NETWORK', message: (e as Error).message, retryable: true },
    } as ResponseFor<R>;
  }
}
