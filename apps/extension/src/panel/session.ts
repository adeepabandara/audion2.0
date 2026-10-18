import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  CONTEXT_INTERVAL_MS,
  DEFAULT_PAUSE_MS,
  isSign,
  type Settings,
  type Sign,
} from '@audion/shared';
import {
  classifyMediaError,
  CAMERA_CONSTRAINTS,
  lightingFrom,
  sampleVideoLuminance,
} from '../lib/camera';
import { handsNearEdge, type LandmarkFrame } from '../lib/landmarks';
import { watchCaptions } from '../lib/meetDom';
import { playAudio } from '../lib/audioPlayer';
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
import { MeetingContext, type MeetingContextLike } from './meetingContext';
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
    'holdTimeMs' | 'pauseMs' | 'speakMode' | 'voiceId' | 'speed' | 'postToChat' | 'monitorVoice'
  > &
    Partial<Pick<Settings, 'fastSigns' | 'cloudCheck' | 'meetingContext' | 'language' | 'pitch'>>;
  /** Voice into the call: the MAIN-world inject script behind a postMessage bridge. */
  voice: VoiceChannel;
  /**
   * Follows the meeting's captions and keeps a short summary for wording sentences (opt-in). Absent in tests that do not
   * exercise it.
   */
  context?: MeetingContextLike;
  /**
   * Play a sentence on this device's speakers without the call channel. Used when Meet has not given us the
   * microphone (for example while it is muted), so the signer still hears their own voice.
   */
  playLocal(audio: Uint8Array): Promise<unknown>;
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
      pauseMs: DEFAULT_PAUSE_MS,
      speakMode: 'auto',
      voiceId: 'aria',
      speed: 1,
      postToChat: false,
      monitorVoice: true,
      fastSigns: true,
      cloudCheck: false,
      meetingContext: false,
      language: 'en',
      pitch: 0,
    }),
    voice: new VoiceBridge(),
    context: new MeetingContext({
      send: realSend as SessionDeps['send'],
      watch: (onSnapshot) => watchCaptions(onSnapshot),
      intervalMs: CONTEXT_INTERVAL_MS,
      firstMs: 15_000,
    }),
    playLocal: (audio) => playAudio(audio),
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
/**
 * Ask "Did you mean ...?" when the model is unsure of a sign. Off for now: every recognised sign is accepted as it is.
 * The popover, the machine events and the threshold logic are all still in place, so turning this on again is this
 * one flag (the threshold the server reports then decides what counts as unsure).
 */
export const CONFIRM_UNSURE_SIGNS = false;

/**
 * With no cloud check there is nobody to hand an unsure sign to, so the on-device answer is accepted down to this
 * confidence (about 88% right on held-out test clips, answering on 91% of them); below it the signer signs again.
 */
export const DEVICE_ONLY_MIN_CONFIDENCE = 0.5;

/** What the on-device classifier did with a sign. */
interface Named {
  /** Id of the chip it put on screen, when it was sure enough. */
  chipId: number | null;
  /** unavailable: no model, no answer, or the setting is off, so the cloud decides. */
  outcome: 'named' | 'unsure' | 'unavailable';
}

/** How much recent hand movement to keep for naming a sign on the device. A sign lasts at most 4 s. */
const FRAME_BUFFER_MS = 6000;

const CAP_NOTICE = 'Daily limit reached. Try tomorrow.';

type Listener = (s: MachineState) => void;

/** What each step of the pipeline did and how long it took, for the web demo's "Live pipeline" log. */
/** What the on-device model saw for one sign, for the live log (all optional: older callers and tests omit them). */
export interface SignDetail {
  /** The three best guesses, best first. */
  top?: Array<{ sign: string; confidence: number }>;
  /** Frames with a hand in the sign. */
  frames?: number;
  /** The most hands in view at once. */
  hands?: number;
}

export type TraceEvent =
  | ({ kind: 'device'; sign: string; confidence: number; ms: number } & SignDetail)
  | ({
      kind: 'device-unsure';
      sign: string;
      confidence: number;
      threshold: number;
      ms: number;
      /** What happens next: the cloud decides, or the signer is asked to sign again. */
      then: 'cloud' | 'retry';
    } & SignDetail)
  | { kind: 'cloud'; role: 'check' | 'answer'; sign: string; ms: number; deviceSign?: string }
  | { kind: 'sentence'; sentence: string; writer: string; ms: number }
  | { kind: 'translate'; language: string; ms: number }
  | { kind: 'voice'; voiceId: string; ms: number }
  | { kind: 'context'; summary: string; ms: number; chars: number };

/**
 * Orchestrates one Audion session: camera, hand tracking, sign segmentation, clip recording, recognition and
 * the panel state machine. Video and clips live in memory only and are dropped as soon as they are used.
 */
export class AudionSession {
  private state: MachineState = initialMachine();
  private listeners = new Set<Listener>();
  private frameListeners = new Set<(f: LandmarkFrame) => void>();
  private pauseListeners = new Set<() => void>();
  private traceListeners = new Set<(e: TraceEvent) => void>();
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
  /** The language the sentence on screen is in ('en', or the language it was translated into). */
  private sentenceLanguage = 'en';
  private signLog: string[] = [];
  private offChannel: (() => void) | null = null;
  private offDelivery: (() => void) | null = null;
  private offContext: (() => void) | null = null;
  /** Recent landmark frames, so the sign that just ended can be named on this device. Memory only, seconds long. */
  private frameBuf: LandmarkFrame[] = [];

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

  /** Each pipeline step reports what it did (who named the sign, who wrote the sentence, which voice) and its time. */
  onTrace(l: (e: TraceEvent) => void): () => void {
    this.traceListeners.add(l);
    return () => this.traceListeners.delete(l);
  }

  private trace(e: TraceEvent): void {
    this.traceListeners.forEach((l) => l(e));
  }

  /**
   * Start or stop following the meeting's captions (the opt-in "Meeting context" setting). Only while Ola is on.
   * Stopping throws away the captions and the summary.
   */
  setMeetingContext(on: boolean): void {
    const ctx = this.deps.context;
    if (!ctx) return;
    if (on && this.state.on) {
      if (!this.offContext) {
        const offChange = ctx.onChange((u) =>
          this.dispatch({
            type: 'CONTEXT',
            state: u.state,
            summary: u.summary,
            updating: u.updating,
          }),
        );
        const offRefresh = ctx.onRefreshed?.((i) => this.trace({ kind: 'context', ...i }));
        this.offContext = () => {
          offChange();
          offRefresh?.();
        };
      }
      ctx.start();
    } else {
      ctx.stop();
      this.offContext?.();
      this.offContext = null;
      if (this.state.context.state !== 'off')
        this.dispatch({ type: 'CONTEXT', state: 'off', summary: null, updating: false });
    }
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
    this.frameBuf = [];
    this.darkStreak = this.edgeStreak = this.notEdgeStreak = 0;
    this.lightTimer = -Infinity;

    void this.deps.send({ type: 'api/health' }).then((h) => {
      const res = h as { ok?: boolean; confidenceThreshold?: number; modelId?: string } | undefined;
      if (run !== this.run || !res?.ok) return;
      if (typeof res.confidenceThreshold === 'number') this.threshold = res.confidenceThreshold;
      if (res.modelId) this.dispatch({ type: 'MODEL_ID', modelId: res.modelId });
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
      onResult: (res, job) => {
        if (res.modelId) this.dispatch({ type: 'MODEL_ID', modelId: res.modelId });
        if (job.verifyFor !== undefined) {
          const was = this.state.chips.find((c) => c.id === job.verifyFor)?.sign;
          this.trace({
            kind: 'cloud',
            role: 'check',
            sign: res.sign,
            ms: res.latencyMs,
            ...(was ? { deviceSign: was } : {}),
          });
          this.dispatch({
            type: 'VERIFIED',
            chipId: job.verifyFor,
            sign: res.sign as Sign | 'unknown',
          });
          if (was && res.sign !== 'unknown' && res.sign !== was) {
            this.showNotice(`Changed “${was}” to “${res.sign}”.`);
          }
          return;
        }
        this.trace({ kind: 'cloud', role: 'answer', sign: res.sign, ms: res.latencyMs });
        this.dispatch({
          type: 'RECOGNISED',
          sign: res.sign as Sign | 'unknown',
          confidence: res.confidence,
          threshold: CONFIRM_UNSURE_SIGNS ? this.threshold : 0,
        });
        if (res.sign === 'unknown') this.autoDismissNotRecognised();
      },
      onDropped: (error, job) => {
        if (error?.code === 'DAILY_CAP_REACHED') this.showNotice(CAP_NOTICE);
        if (job.verifyFor !== undefined) {
          // The device already answered; the check just could not be made, so the device answer stands.
          this.dispatch({ type: 'VERIFIED', chipId: job.verifyFor, sign: 'unknown' });
          return;
        }
        this.dispatch({ type: 'RECOGNISE_FAILED', retryable: false });
        this.autoDismissNotRecognised();
      },
      onOnline: (online) => this.dispatch({ type: 'ONLINE', online }),
    });
    this.deps.voice.configure({ enabled: true, voiceMuted: this.voiceMuted });
    this.offChannel = this.deps.voice.onChannel(({ hasChannel, micMuted }) => {
      this.dispatch({ type: 'CALL_AUDIO', connected: hasChannel });
      this.dispatch({ type: 'MIC_MUTED', muted: micMuted });
    });
    this.offDelivery = this.deps.voice.onDelivery((sent) =>
      this.dispatch({ type: 'DELIVERY', sent }),
    );
    // Meet may have asked for the microphone before Ola was switched on, so ask the page script what it has now.
    void this.deps.voice.probe().then((p) => {
      if (run !== this.run) return;
      this.dispatch({ type: 'CALL_AUDIO', connected: p.hasChannel });
      this.dispatch({ type: 'MIC_MUTED', muted: p.micMuted });
    });
    this.dispatch({ type: 'CAMERA_READY' });
    this.setMeetingContext(this.deps.settings().meetingContext === true);
    this.loop = this.deps.setInterval(() => void this.tick(), FRAME_INTERVAL_MS);
  }

  turnOff(): void {
    this.run++;
    this.setMeetingContext(false);
    if (this.loop !== undefined) this.deps.clearInterval(this.loop);
    this.loop = undefined;
    this.recorder?.disarm();
    this.recorder = null;
    this.queue?.stop(); // discards any clips still waiting
    this.frameBuf = [];
    this.queue = null;
    this.deps.tracker.stop();
    this.releaseCamera();
    // Audion Off: nothing of Audion is added to the call any more; the plain microphone passes through.
    this.deps.voice.configure({ enabled: false, voiceMuted: this.voiceMuted });
    this.offChannel?.();
    this.offChannel = null;
    this.offDelivery?.();
    this.offDelivery = null;
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
    const composeStart = this.deps.now();
    // The meeting summary (opt-in) helps word the sentence; it never replaces what was signed.
    const context = this.deps.settings().meetingContext ? this.deps.context?.summary() : null;
    const res = (await this.deps.send({
      type: 'api/compose',
      signs,
      ...(context ? { context } : {}),
    })) as
      | { ok: true; sentence: string; writer?: string }
      | { ok: false; error?: { retryable?: boolean } }
      | undefined;
    if (run !== this.run) return;
    if (!res?.ok) {
      this.dispatch({ type: 'COMPOSE_FAILED', retryable: res?.error?.retryable ?? true });
      return;
    }
    this.sentenceSigns = signs;
    this.trace({
      kind: 'sentence',
      sentence: res.sentence,
      writer: res.writer ?? 'the cloud model',
      ms: Math.round(this.deps.now() - composeStart),
    });
    // Live translation: the sentence shown, captioned and spoken is the translation; if that fails the English one is
    // kept and the signer is told in a few words.
    let sentence = res.sentence;
    this.sentenceLanguage = 'en';
    const language = this.deps.settings().language ?? 'en';
    if (language !== 'en') {
      const translateStart = this.deps.now();
      const t = (await this.deps.send({
        type: 'api/translate',
        text: sentence,
        language,
      })) as { ok: true; text: string } | { ok: false } | undefined;
      if (run !== this.run) return;
      if (t?.ok) {
        sentence = t.text;
        this.sentenceLanguage = language;
        this.trace({
          kind: 'translate',
          language,
          ms: Math.round(this.deps.now() - translateStart),
        });
      } else {
        this.showNotice('Translation failed. Using English.');
      }
    }
    this.dispatch({ type: 'COMPOSED', sentence });
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
      const speakStart = this.deps.now();
      const audio = (await this.deps.send({
        type: 'api/speak',
        text,
        voiceId: cfg.voiceId,
        speed: cfg.speed,
        ...(this.sentenceLanguage !== 'en' ? { language: this.sentenceLanguage } : {}),
        ...(cfg.pitch ? { pitch: cfg.pitch } : {}),
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
      this.trace({
        kind: 'voice',
        voiceId: cfg.voiceId,
        ms: Math.round(this.deps.now() - speakStart),
      });
      const bytes = fromBase64(audio.audioBase64);
      const result = await this.deps.voice.speak(bytes, { monitor: cfg.monitorVoice });
      if (run !== this.run) return;
      // No call channel (Meet has not given us the microphone, e.g. while muted): others cannot hear this, but
      // the signer still should. The panel keeps saying the voice is not connected to the call.
      if (result === 'no-channel' && cfg.monitorVoice) {
        void Promise.resolve(this.deps.playLocal(bytes)).catch(() => {});
      }
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
    this.showNotice(
      result === 'draft' ? 'Not posted: chat has a draft.' : 'Couldn’t post to chat.',
    );
  }

  private showNotice(text: string) {
    this.dispatch({ type: 'NOTICE', text });
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
      this.frameBuf.push(frame);
      while (this.frameBuf.length && frame.t - this.frameBuf[0]!.t > FRAME_BUFFER_MS)
        this.frameBuf.shift();
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
      case 'signEnd': {
        this.dispatch({ type: 'CLIP_READY' });
        const run = this.run;
        void this.takeClip(run, this.nameOnDevice(ev.startT, ev.endT, run));
        break;
      }
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

  /**
   * Try to name the sign that just ended with the on-device classifier. Resolves with the new chip's id when the
   * device was confident enough (the chip is already on screen), else null and the cloud decides as before.
   */
  private nameOnDevice(startT: number, endT: number, run: number): Promise<Named> {
    const tracker = this.deps.tracker;
    const cfg = this.deps.settings();
    const none: Named = { chipId: null, outcome: 'unavailable' };
    if (cfg.fastSigns === false || !tracker.classify) return Promise.resolve(none);
    const cloudChecks = cfg.cloudCheck === true;
    const frames = this.frameBuf.filter((f) => f.t >= startT && f.t <= endT);
    const v = this.video;
    const aspect = v?.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
    const t0 = this.deps.now();
    return tracker
      .classify(frames, startT, endT, aspect)
      .then((r): Named => {
        if (run !== this.run || !r) return none;
        const ms = Math.round(this.deps.now() - t0);
        const needs = cloudChecks ? r.threshold : Math.min(r.threshold, DEVICE_ONLY_MIN_CONFIDENCE);
        if (r.confidence < needs || !isSign(r.sign)) {
          this.trace({
            kind: 'device-unsure',
            sign: r.sign,
            confidence: r.confidence,
            threshold: needs,
            ms,
            then: cloudChecks ? 'cloud' : 'retry',
            top: r.top,
            frames: r.frames,
            hands: r.hands,
          });
          return { chipId: null, outcome: 'unsure' };
        }
        this.trace({
          kind: 'device',
          sign: r.sign,
          confidence: r.confidence,
          ms,
          top: r.top,
          frames: r.frames,
          hands: r.hands,
        });
        const chipId = this.state.nextId;
        this.dispatch({
          type: 'RECOGNISED_FAST',
          sign: r.sign,
          confidence: r.confidence,
          checking: cloudChecks,
        });
        return { chipId, outcome: 'named' };
      })
      .catch(() => none);
  }

  private async takeClip(run: number, named: Promise<Named>): Promise<void> {
    const recorder = this.recorder;
    const [clip, { chipId, outcome }] = await Promise.all([
      recorder ? recorder.finish() : null,
      named,
    ]);
    if (run !== this.run) return; // turned off meanwhile: drop the footage
    if (this.seg.phase !== 'idle') this.recorder?.arm(); // hands still up: ready for the next sign
    // Device only (no cloud check): the classifier's word is final and the clip is dropped, never sent anywhere.
    // If the classifier was unavailable, the cloud still answers so a missing model does not stop recognition.
    if (this.deps.settings().cloudCheck !== true && outcome !== 'unavailable') {
      if (outcome === 'unsure') {
        this.dispatch({ type: 'RECOGNISE_FAILED', retryable: false });
        this.autoDismissNotRecognised();
      }
      return;
    }
    const queued =
      !!clip &&
      !!this.queue?.enqueue({
        clip: clip.blob,
        mime: clip.mime,
        durationMs: clip.durationMs,
        ...(chipId !== null ? { verifyFor: chipId } : {}),
      });
    if (queued) return;
    if (chipId !== null) {
      // The device already answered, so there is nothing to wait for; the chip just stays unchecked-by-cloud.
      this.dispatch({ type: 'VERIFIED', chipId, sign: 'unknown' });
      return;
    }
    this.dispatch({ type: 'RECOGNISE_FAILED', retryable: false });
    this.autoDismissNotRecognised();
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
