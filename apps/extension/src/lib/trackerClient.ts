import type { DeviceAnswer } from './classifier';
import type { LandmarkFrame } from './landmarks';
import { isFromTracker, TRACKER_SOURCE, type FromTracker, type ToTracker } from './trackerProtocol';

export interface HandTracker {
  /** Resolves when the model is loaded; rejects with a readable message if it cannot start. */
  start(): Promise<void>;
  /** One frame in, landmarks out. Null if the tracker is busy or stopped. */
  detect(video: HTMLVideoElement): Promise<LandmarkFrame | null>;
  /** Name a finished sign on this device (optional; absent in tests and when the model is missing). */
  classify?(
    frames: LandmarkFrame[],
    startT: number,
    endT: number,
    aspect: number,
  ): Promise<DeviceAnswer | null>;
  stop(): void;
}

const FRAME = { width: 320, height: 240 };

/**
 * Talks to the tracker iframe. A content script cannot start an extension-origin Worker, so MediaPipe runs in a
 * hidden extension-origin iframe (its own process under site isolation, so Meet's page thread stays free).
 */
export class IframeTracker implements HandTracker {
  private iframe: HTMLIFrameElement | null = null;
  private nextId = 1;
  private inFlight: { id: number; resolve(f: LandmarkFrame | null): void } | null = null;
  private onMessage: ((e: MessageEvent) => void) | null = null;
  private readyWaiters: Array<{ resolve(): void; reject(e: Error): void }> = [];
  private ready = false;
  private classifying = new Map<
    number,
    (r: Extract<FromTracker, { type: 'classified' }>['result']) => void
  >();

  constructor(
    private readonly url: string,
    private readonly mountInto: Node = document.body,
    private readonly startTimeoutMs = 30_000,
  ) {}

  start(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (!this.iframe) {
      const origin = new URL(this.url, location.href).origin;
      const iframe = document.createElement('iframe');
      iframe.src = this.url;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.style.cssText =
        'position:fixed;width:1px;height:1px;border:0;opacity:0;pointer-events:none;bottom:0;right:0;';
      this.onMessage = (e: MessageEvent) => {
        if (e.origin !== origin || e.source !== iframe.contentWindow || !isFromTracker(e.data))
          return;
        this.handle(e.data);
      };
      window.addEventListener('message', this.onMessage);
      this.mountInto.appendChild(iframe);
      this.iframe = iframe;
      iframe.addEventListener('load', () => this.post({ source: TRACKER_SOURCE, type: 'init' }));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Hand tracking took too long to start.')),
        this.startTimeoutMs,
      );
      this.readyWaiters.push({
        resolve: () => (clearTimeout(timer), resolve()),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
    });
  }

  private handle(msg: FromTracker) {
    if (msg.type === 'ready') {
      this.ready = true;
      this.readyWaiters.splice(0).forEach((w) => w.resolve());
    } else if (msg.type === 'error') {
      this.readyWaiters.splice(0).forEach((w) => w.reject(new Error(msg.message)));
    } else if (msg.type === 'classified') {
      this.classifying.get(msg.id)?.(msg.result);
    } else if (msg.type === 'landmarks' && this.inFlight?.id === msg.id) {
      const { resolve } = this.inFlight;
      this.inFlight = null;
      resolve({ t: msg.t, hands: msg.hands, pose: msg.pose ?? null });
    }
  }

  private post(msg: ToTracker, transfer: Transferable[] = []) {
    if (!this.iframe?.contentWindow) return;
    const origin = new URL(this.url, location.href).origin;
    this.iframe.contentWindow.postMessage(msg, origin, transfer);
  }

  async detect(video: HTMLVideoElement): Promise<LandmarkFrame | null> {
    if (!this.ready || this.inFlight || video.readyState < 2 || !video.videoWidth) return null;
    const id = this.nextId++;
    const t = performance.now();
    const bitmap = await createImageBitmap(video, {
      resizeWidth: FRAME.width,
      resizeHeight: FRAME.height,
    });
    return new Promise<LandmarkFrame | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.inFlight?.id === id) this.inFlight = null;
        resolve(null);
      }, 2000);
      this.inFlight = { id, resolve: (f) => (clearTimeout(timer), resolve(f)) };
      this.post({ source: TRACKER_SOURCE, type: 'frame', id, t, bitmap }, [bitmap]);
    });
  }

  classify(frames: LandmarkFrame[], startT: number, endT: number, aspect: number) {
    if (!this.ready) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise<Extract<FromTracker, { type: 'classified' }>['result']>((resolve) => {
      const done = (r: Extract<FromTracker, { type: 'classified' }>['result']) => {
        clearTimeout(timer);
        this.classifying.delete(id);
        resolve(r);
      };
      // A slow answer is worth nothing: the cloud will answer anyway.
      const timer = setTimeout(() => done(null), 1500);
      this.classifying.set(id, done);
      this.post({ source: TRACKER_SOURCE, type: 'classify', id, frames, startT, endT, aspect });
    });
  }

  stop(): void {
    this.classifying.forEach((done) => done(null));
    this.inFlight?.resolve(null);
    this.inFlight = null;
    if (this.onMessage) window.removeEventListener('message', this.onMessage);
    this.onMessage = null;
    this.iframe?.remove();
    this.iframe = null;
    this.ready = false;
    this.readyWaiters.splice(0).forEach((w) => w.reject(new Error('Stopped.')));
  }
}
