import type { Hand } from './landmarks';

/** Messages between the content script and the extension-origin tracker iframe. */
export const TRACKER_SOURCE = 'audion-tracker';

export type ToTracker =
  | { source: typeof TRACKER_SOURCE; type: 'init' }
  | { source: typeof TRACKER_SOURCE; type: 'frame'; id: number; t: number; bitmap: ImageBitmap };

export type FromTracker =
  | { source: typeof TRACKER_SOURCE; type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { source: typeof TRACKER_SOURCE; type: 'error'; message: string }
  | { source: typeof TRACKER_SOURCE; type: 'landmarks'; id: number; t: number; hands: Hand[] };

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
export const ALLOWED_HOST_ORIGINS = ['https://meet.google.com', 'http://localhost:4173'];
