import type { Hand, LandmarkFrame } from './landmarks';

/** Messages between the content script and the extension-origin tracker iframe. */
export const TRACKER_SOURCE = 'audion-tracker';

export type ToTracker =
  | { source: typeof TRACKER_SOURCE; type: 'init' }
  | { source: typeof TRACKER_SOURCE; type: 'frame'; id: number; t: number; bitmap: ImageBitmap }
  /** Name the sign made between startT and endT from these landmark frames (aspect = video width / height). */
  | {
      source: typeof TRACKER_SOURCE;
      type: 'classify';
      id: number;
      frames: LandmarkFrame[];
      startT: number;
      endT: number;
      aspect: number;
    };

export type FromTracker =
  | { source: typeof TRACKER_SOURCE; type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { source: typeof TRACKER_SOURCE; type: 'error'; message: string }
  | { source: typeof TRACKER_SOURCE; type: 'landmarks'; id: number; t: number; hands: Hand[] }
  /** null when the on-device model is unavailable or had too little to go on. */
  | {
      source: typeof TRACKER_SOURCE;
      type: 'classified';
      id: number;
      result: { sign: string; confidence: number; threshold: number } | null;
    };

export function isFromTracker(data: unknown): data is FromTracker {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === TRACKER_SOURCE
  );
}

export function isToTracker(data: unknown): data is ToTracker {
  return isFromTracker(data); // same envelope check; payload fields are validated where used
}

/** Pages allowed to embed the tracker (mirrors the content-script matches). */
// The local fake Meet origin exists only in dev/e2e builds (AUDION_FAKE_MEET=1), never in a release.
export const ALLOWED_HOST_ORIGINS = [
  'https://meet.google.com',
  ...(process.env.AUDION_FAKE_MEET === '1' ? ['http://localhost:4173'] : []),
  // The public web demo embeds its own tracker page from the same site (never in the extension build).
  ...(process.env.AUDION_WEB === '1' && typeof location !== 'undefined' ? [location.origin] : []),
];
