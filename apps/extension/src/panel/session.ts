import { DEFAULT_CONFIDENCE_THRESHOLD, type Settings, type Sign } from '@audion/shared';
import {
  classifyMediaError,
  CAMERA_CONSTRAINTS,
  lightingFrom,
  sampleVideoLuminance,
} from '../lib/camera';
import { handsNearEdge, type LandmarkFrame } from '../lib/landmarks';
import { send as realSend, toBase64, type Request } from '../lib/messages';
import {
  createRecognitionQueue,
  type ClipJob,
  type RecognitionQueue,
} from '../lib/recognitionQueue';
import { ClipRecorder } from '../lib/recorder';
import {
  DEFAULT_SEGMENTER,
  initialSegmenter,
  stepSegmenter,
  type SegmenterConfig,
  type SegmenterEvent,
  type SegmenterState,
} from '../lib/segmenter';
import type { HandTracker } from '../lib/trackerClient';
import { initialMachine, reduce, type MachineEvent, type MachineState } from './machine';

export interface SessionDeps {
  tracker: HandTracker;
  getCamera(): Promise<MediaStream>;
  createRecorder(
    stream: MediaStream,
  ): Pick<ClipRecorder, 'arm' | 'disarm' | 'signStarted' | 'finish'>;
  send(req: Request): Promise<unknown>;
  settings(): Pick<Settings, 'holdTimeMs' | 'pauseMs'>;
  luminance(video: HTMLVideoElement): number | null;
  now(): number;
  /** Time source for the capture loop and timers; replaced in tests. */
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export function defaultDeps(trackerFor: () => HandTracker): SessionDeps {
  return {
    tracker: trackerFor(),
    getCamera: () => navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS),
    createRecorder: (stream) => new ClipRecorder(stream),
    send: realSend as SessionDeps['send'],
    settings: () => ({ holdTimeMs: 400, pauseMs: 1500 }),
    luminance: sampleVideoLuminance,
    now: () => performance.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
}

const FRAME_INTERVAL_MS = 66; // ~15 fps
const LIGHT_EVERY_MS = 500;
const EDGE_FRAMES = 3;
const NOT_RECOGNISED_MS = 4000;

type Listener = (s: MachineState) => void;

/**
 * Orchestrates one Audion session: camera, hand tracking, sign segmentation, clip recording, recognition and
 * the panel state machine. Video and clips live in memory only and are dropped as soon as they are used.
 */
export class AudionSession {
  private state: MachineState = initialMachine();
  private listeners = new Set<Listener>();
  private frameListeners = new Set<(f: LandmarkFrame) => void>();
  private pauseListeners = new Set<() => void>();
  private seg: SegmenterState = initialSegmenter();
  private video: HTMLVideoElement | null = null;
  private preview: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private recorder: ReturnType<SessionDeps['createRecorder']> | null = null;
  private queue: RecognitionQueue | null = null;
  private loop: unknown;
  private busy = false;
  private threshold = DEFAULT_CONFIDENCE_THRESHOLD;
  private run = 0; // invalidates async work that belongs to a previous On/Off cycle
  private lightTimer = -Infinity;
  private darkStreak = 0;
  private edgeStreak = 0;
  private notEdgeStreak = 0;
  private dismissTimer: unknown;

  constructor(private readonly deps: SessionDeps) {}

  getState = (): MachineState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Latest landmarks for the preview overlay. Kept off React state: it changes ~15 times a second. */
  onFrame(l: (f: LandmarkFrame) => void): () => void {
    this.frameListeners.add(l);
    return () => this.frameListeners.delete(l);
  }

  /** The signer paused after at least one sign (M6 uses this to compose a sentence). */
  onPause(l: () => void): () => void {
    this.pauseListeners.add(l);
    return () => this.pauseListeners.delete(l);
  }

  dispatch = (e: MachineEvent): void => {
    this.state = reduce(this.state, e);
    this.listeners.forEach((l) => l(this.state));
  };

  /** The panel's preview <video>; the session feeds the camera into it and samples frames from it. */
  attachVideo(el: HTMLVideoElement | null): void {
    this.video = el;
    if (el && this.stream) el.srcObject = this.stream;
  }

  /** The visible preview in the expanded card (shows the same stream; not used for analysis). */
  attachPreview(el: HTMLVideoElement | null): void {
    this.preview = el;
    if (el && this.stream) el.srcObject = this.stream;
  }

  async turnOn(): Promise<void> {
    if (this.state.on) return;
    const run = ++this.run;
    this.dispatch({ type: 'TURN_ON' });
    this.seg = initialSegmenter();
    this.darkStreak = this.edgeStreak = this.notEdgeStreak = 0;
    this.lightTimer = -Infinity;

    void this.deps.send({ type: 'api/health' }).then((h) => {
      const res = h as { ok?: boolean; confidenceThreshold?: number } | undefined;
      if (run === this.run && res?.ok && typeof res.confidenceThreshold === 'number')
        this.threshold = res.confidenceThreshold;
    });

    let stream: MediaStream;
    try {
      stream = await this.deps.getCamera();
    } catch (e) {
      if (run === this.run)
        this.dispatch({ type: 'CAMERA_FAILED', problem: classifyMediaError(e) });
      return;
    }
    if (run !== this.run) return stream.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    if (this.video) this.video.srcObject = stream;
    if (this.preview) this.preview.srcObject = stream;

    try {
      await this.deps.tracker.start();
    } catch {
      if (run !== this.run) return;
      this.releaseCamera();
      this.dispatch({ type: 'CAMERA_FAILED', problem: 'unknown' });
      return;
    }
    if (run !== this.run) return;

    this.recorder = this.deps.createRecorder(stream);
    this.queue = createRecognitionQueue({
      recognize: async (job: ClipJob) =>
        (await this.deps.send({
          type: 'api/recognize',
          clipBase64: toBase64(await job.clip.arrayBuffer()),
          mime: job.mime,
          durationMs: job.durationMs,
        })) as never,
      onResult: (res) => {
        this.dispatch({
          type: 'RECOGNISED',
          sign: res.sign as Sign | 'unknown',
          confidence: res.confidence,
          threshold: this.threshold,
        });
        if (res.sign === 'unknown') this.autoDismissNotRecognised();
      },
      onDropped: () => {
        this.dispatch({ type: 'RECOGNISE_FAILED', retryable: false });
        this.autoDismissNotRecognised();
      },
      onOnline: (online) => this.dispatch({ type: 'ONLINE', online }),
    });
    this.dispatch({ type: 'CAMERA_READY' });
    this.loop = this.deps.setInterval(() => void this.tick(), FRAME_INTERVAL_MS);
  }

  turnOff(): void {
    this.run++;
    if (this.loop !== undefined) this.deps.clearInterval(this.loop);
    this.loop = undefined;
    this.recorder?.disarm();
    this.recorder = null;
    this.queue?.stop(); // discards any clips still waiting
    this.queue = null;
    this.deps.tracker.stop();
    this.releaseCamera();
    if (this.dismissTimer !== undefined) this.deps.clearTimeout(this.dismissTimer);
    this.dispatch({ type: 'TURN_OFF' });
  }

  private releaseCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    if (this.preview) this.preview.srcObject = null;
  }

  confirmYes = () => this.dispatch({ type: 'CONFIRM_YES' });
  confirmRetry = () => this.dispatch({ type: 'CONFIRM_RETRY' });
  clear = () => this.dispatch({ type: 'CLEAR' });

  /** Process one frame. The capture loop calls this; tests call it directly with scripted frames. */
  async tick(frameOverride?: LandmarkFrame): Promise<void> {
    if (this.busy || !this.state.on || this.state.starting) return;
    const video = this.video;
    if (!frameOverride && !video) return;
    this.busy = true;
    const run = this.run;
    try {
      const frame = frameOverride ?? (await this.deps.tracker.detect(video!));
      if (!frame || run !== this.run) return;
      this.frameListeners.forEach((l) => l(frame));
      this.checkLighting(frame.t, video);
      this.checkEdge(frame);

      const s = this.deps.settings();
      const cfg: SegmenterConfig = {
        ...DEFAULT_SEGMENTER,
        holdMs: s.holdTimeMs,
        pauseMs: s.pauseMs,
      };
      const [next, events] = stepSegmenter(this.seg, frame, cfg);
      this.seg = next;
      for (const ev of events) this.handle(ev);
    } finally {
      this.busy = false;
    }
  }

  private handle(ev: SegmenterEvent): void {
    switch (ev.type) {
      case 'handsAppeared':
        this.dispatch({ type: 'HANDS_APPEARED' });
        this.recorder?.arm();
        break;
      case 'handsLeft':
        this.dispatch({ type: 'HANDS_LEFT' });
        this.recorder?.disarm(); // after a clip was taken this is a no-op: finish() already detached it
        break;
      case 'signStart':
        this.dispatch({ type: 'SIGN_STARTED' });
        this.recorder?.signStarted();
        break;
      case 'signEnd':
        this.dispatch({ type: 'CLIP_READY' });
        void this.takeClip(this.run);
        break;
      case 'signDiscarded':
        this.dispatch({ type: 'CLIP_DISCARDED', reason: ev.reason });
        this.recorder?.disarm();
        if (this.seg.phase !== 'idle') this.recorder?.arm();
        this.autoDismissNotRecognised();
        break;
      case 'pause':
        this.pauseListeners.forEach((l) => l());
        break;
    }
  }

  private async takeClip(run: number): Promise<void> {
    const recorder = this.recorder;
    const clip = recorder ? await recorder.finish() : null;
    if (run !== this.run) return; // turned off meanwhile: drop the footage
    if (this.seg.phase !== 'idle') this.recorder?.arm(); // hands still up: ready for the next sign
    if (
      !clip ||
      !this.queue?.enqueue({ clip: clip.blob, mime: clip.mime, durationMs: clip.durationMs })
    ) {
      this.dispatch({ type: 'RECOGNISE_FAILED', retryable: false });
      this.autoDismissNotRecognised();
    }
  }

  private checkLighting(t: number, video: HTMLVideoElement | null) {
    if (!video || t - this.lightTimer < LIGHT_EVERY_MS) return;
    this.lightTimer = t;
    const mean = this.deps.luminance(video);
    if (mean === null) return;
    this.darkStreak = lightingFrom(mean) === 'dark' ? this.darkStreak + 1 : 0;
    // Two dark readings in a row to turn the hint on, one good reading to turn it off: no flicker.
    if (this.darkStreak >= 2) this.dispatch({ type: 'LIGHT', dark: true });
    else if (this.darkStreak === 0 && this.state.problems.includes('lowLight'))
      this.dispatch({ type: 'LIGHT', dark: false });
  }

  private checkEdge(frame: LandmarkFrame) {
    if (frame.hands.length === 0) return;
    if (handsNearEdge(frame)) {
      this.notEdgeStreak = 0;
      if (++this.edgeStreak === EDGE_FRAMES) this.dispatch({ type: 'HANDS_EDGE', out: true });
    } else {
      this.edgeStreak = 0;
      if (++this.notEdgeStreak === EDGE_FRAMES && this.state.problems.includes('handsOut')) {
        this.dispatch({ type: 'HANDS_EDGE', out: false });
      }
    }
  }

  private autoDismissNotRecognised() {
    if (this.dismissTimer !== undefined) this.deps.clearTimeout(this.dismissTimer);
    this.dismissTimer = this.deps.setTimeout(
      () => this.dispatch({ type: 'DISMISS', problem: 'notRecognised' }),
      NOT_RECOGNISED_MS,
    );
  }
}
