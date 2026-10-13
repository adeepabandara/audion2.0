import { DEFAULT_CONFIDENCE_THRESHOLD, type Settings, type Sign } from '@audion/shared';
import {
  classifyMediaError,
  CAMERA_CONSTRAINTS,
  lightingFrom,
  sampleVideoLuminance,
} from '../lib/camera';
import { handsNearEdge, type LandmarkFrame } from '../lib/landmarks';
import { postToChat, type ChatPostResult } from '../lib/meetDom';
import { fromBase64, send as realSend, toBase64, type Request } from '../lib/messages';
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
import { VoiceBridge, type VoiceChannel } from '../lib/voiceBridge';
import {
  initialMachine,
  pendingChip,
  reduce,
  type MachineEvent,
  type MachineState,
} from './machine';

export interface SessionDeps {
  tracker: HandTracker;
  getCamera(): Promise<MediaStream>;
  createRecorder(
    stream: MediaStream,
  ): Pick<ClipRecorder, 'arm' | 'disarm' | 'signStarted' | 'finish'>;
  send(req: Request): Promise<unknown>;
  settings(): Pick<
    Settings,
    'holdTimeMs' | 'pauseMs' | 'speakMode' | 'voiceId' | 'speed' | 'postToChat'
  >;
  /** Voice into the call: the MAIN-world inject script behind a postMessage bridge. */
  voice: VoiceChannel;
  /** Post a sentence to Meet chat (setting: postToChat). */
  chat(text: string): Promise<ChatPostResult>;
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
    settings: () => ({
      holdTimeMs: 400,
      pauseMs: 1500,
      speakMode: 'auto',
      voiceId: 'aria',
      speed: 1,
      postToChat: false,
    }),
    voice: new VoiceBridge(),
    chat: (text) => postToChat(text),
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
const CAPTION_MS = 5000;
const NOTICE_MS = 6000;

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
  private captionTimer: unknown;
  private noticeTimer: unknown;
  private voiceMuted = false;
  private pauseSeen = false;
  private externalFrames = false;
  private sentenceSigns: string[] = [];
  private signLog: string[] = [];
  private offChannel: (() => void) | null = null;

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
    // Once everything pending is settled, a sentence the signer already paused for can be composed.
    if (
      this.pauseSeen &&
      (e.type === 'RECOGNISED' ||
        e.type === 'RECOGNISE_FAILED' ||
        e.type === 'CONFIRM_YES' ||
        e.type === 'CONFIRM_RETRY')
    ) {
      queueMicrotask(() => void this.maybeCompose());
    }
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
    this.deps.voice.configure({ enabled: true, voiceMuted: this.voiceMuted });
    this.offChannel = this.deps.voice.onChannel(({ micMuted }) =>
      this.dispatch({ type: 'MIC_MUTED', muted: micMuted }),
    );
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
    // Audion Off: nothing of Audion is added to the call any more; the plain microphone passes through.
    this.deps.voice.configure({ enabled: false, voiceMuted: this.voiceMuted });
    this.offChannel?.();
    this.offChannel = null;
    this.pauseSeen = false;
    for (const t of [this.dismissTimer, this.captionTimer, this.noticeTimer]) {
      if (t !== undefined) this.deps.clearTimeout(t);
    }
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
  clear = () => {
    this.pauseSeen = false;
    this.dispatch({ type: 'CLEAR' });
  };

  /** Sign labels (never video or text) behind what was spoken this call; sent only with feedback consent. */
  getSignLog = (): string[] => [...this.signLog];
  clearSignLog = (): void => void (this.signLog = []);

  /** Audion's own mute switch: sentences are still composed and captioned, but not spoken into the call. */
  setVoiceMuted(muted: boolean): void {
    this.voiceMuted = muted;
    if (this.state.on) this.deps.voice.configure({ enabled: true, voiceMuted: muted });
  }

  /** The Speak button: speak the sentence on screen, or compose the signs so far and speak that. */
  speakNow = (): Promise<void> =>
    this.state.sentence !== null ? this.speak() : this.maybeCompose(true);

  /**
   * Turn the confirmed signs into one sentence. Waits until nothing is in flight or awaiting confirmation.
   * Auto-speak mode (or the Speak button) goes straight on to speaking; confirm-first stops at the sentence.
   */
  private async maybeCompose(manual = false): Promise<void> {
    const s = this.state;
    if (!s.on || s.starting || s.composing || s.speaking || s.sentence !== null) return;
    if (s.chips.length === 0 || pendingChip(s) || s.inFlight > 0) return;
    this.pauseSeen = false;
    const run = this.run;
    const signs = s.chips.map((c) => c.sign);
    this.dispatch({ type: 'COMPOSE_START' });
    const res = (await this.deps.send({ type: 'api/compose', signs })) as
      | { ok: true; sentence: string }
      | { ok: false; error?: { retryable?: boolean } }
      | undefined;
    if (run !== this.run) return;
    if (!res?.ok) {
      this.dispatch({ type: 'COMPOSE_FAILED', retryable: res?.error?.retryable ?? true });
      return;
    }
    this.sentenceSigns = signs;
    this.dispatch({ type: 'COMPOSED', sentence: res.sentence });
    if (manual || this.deps.settings().speakMode === 'auto') await this.speak();
  }

  private async speak(): Promise<void> {
    const s = this.state;
    if (!s.on || s.speaking || s.sentence === null) return;
    const text = s.sentence;
    const run = this.run;
    const cfg = this.deps.settings();
    this.dispatch({ type: 'SPEAK_START' });
    if (this.captionTimer !== undefined) this.deps.clearTimeout(this.captionTimer);

    if (!this.voiceMuted) {
      const audio = (await this.deps.send({
        type: 'api/speak',
        text,
        voiceId: cfg.voiceId,
        speed: cfg.speed,
      })) as
        | { ok: true; audioBase64: string }
        | { ok: false; error?: { retryable?: boolean } }
        | undefined;
      if (run !== this.run) return;
      if (!audio?.ok) {
        this.dispatch({
          type: 'SPEAK_FAILED',
          reason: audio?.error?.retryable === false ? 'other' : 'network',
        });
        this.scheduleCaptionClear();
        return;
      }
      const result = await this.deps.voice.speak(fromBase64(audio.audioBase64));
      if (run !== this.run) return;
      if (result === 'no-channel' || result === 'disabled' || result === 'error') {
        this.dispatch({ type: 'SPEAK_FAILED', reason: result === 'error' ? 'other' : 'noChannel' });
        this.scheduleCaptionClear();
        return;
      }
    }

    this.signLog.push(...this.sentenceSigns);
    this.dispatch({ type: 'SPOKEN' });
    this.scheduleCaptionClear();
    void this.afterSpoken(text, run, cfg.postToChat);
  }

  private async afterSpoken(text: string, run: number, postChat: boolean): Promise<void> {
    void this.deps.send({ type: 'transcript/add', text });
    if (!postChat) return;
    const result = await this.deps.chat(text);
    if (run !== this.run || result === 'sent') return;
    this.dispatch({
      type: 'NOTICE',
      text:
        result === 'draft'
          ? 'Not posted to Meet chat: there is a draft in the chat box.'
          : 'Couldn’t post to Meet chat.',
    });
    if (this.noticeTimer !== undefined) this.deps.clearTimeout(this.noticeTimer);
    this.noticeTimer = this.deps.setTimeout(
      () => this.dispatch({ type: 'NOTICE', text: null }),
      NOTICE_MS,
    );
  }

  private scheduleCaptionClear() {
    if (this.captionTimer !== undefined) this.deps.clearTimeout(this.captionTimer);
    this.captionTimer = this.deps.setTimeout(
      () => this.dispatch({ type: 'CAPTION_CLEAR' }),
      CAPTION_MS,
    );
  }

  /** Tests only: ignore the live capture loop so injected frames are the sole input. */
  setExternalFrames(on: boolean): void {
    this.externalFrames = on;
  }

  /** Process one frame. The capture loop calls this; tests call it directly with scripted frames. */
  async tick(frameOverride?: LandmarkFrame): Promise<void> {
    if (this.busy || !this.state.on || this.state.starting) return;
    if (!frameOverride && this.externalFrames) return;
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
        this.pauseSeen = false;
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
        this.pauseSeen = true;
        this.pauseListeners.forEach((l) => l());
        void this.maybeCompose();
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
