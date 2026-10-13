export interface RecorderHandle {
  stop(): Promise<Blob>;
  cancel(): void;
}
export type RecorderFactory = (stream: MediaStream) => RecorderHandle | null;

export const CLIP_MIME = 'video/webm';

/** MediaRecorder-backed handle. Chunks live in memory only. */
export const mediaRecorderFactory: RecorderFactory = (stream) => {
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
  if (!mime) return null;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 800_000 });
  const chunks: Blob[] = [];
  let cancelled = false;
  rec.ondataavailable = (e) => e.data.size && !cancelled && chunks.push(e.data);
  rec.start(200);
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: CLIP_MIME }));
        if (rec.state !== 'inactive') rec.stop();
        else resolve(new Blob(chunks, { type: CLIP_MIME }));
      }),
    cancel() {
      cancelled = true;
      chunks.length = 0;
      if (rec.state !== 'inactive') rec.stop();
    },
  };
};

export interface ClipResult {
  blob: Blob;
  mime: string;
  durationMs: number;
}

export interface ClipRecorderOptions {
  factory?: RecorderFactory;
  /**
   * While hands are visible but no sign has started, the recording restarts this often, so the clip begins at
   * most this long before the sign. That is the pre-roll that keeps the first moment of a sign from being cut.
   * 600 ms keeps pre-roll + 4 s sign + 400 ms hold within the API's 5 s clip limit.
   */
  prerollMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

/**
 * Records the camera only while hands are in view. MediaRecorder cannot hand back footage from before it
 * started (later WebM chunks have no header), so instead of a frame buffer we record from the moment hands
 * appear and re-start the recording while they idle. Output: WebM, in memory, dropped after the response.
 */
export class ClipRecorder {
  private handle: RecorderHandle | null = null;
  private startedAt = 0;
  private timer: unknown;
  private readonly factory: RecorderFactory;
  private readonly preroll: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(
    private readonly stream: MediaStream,
    opts: ClipRecorderOptions = {},
  ) {
    this.factory = opts.factory ?? mediaRecorderFactory;
    this.preroll = opts.prerollMs ?? 600;
    this.now = opts.now ?? (() => performance.now());
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  /** Hands appeared: begin recording (and keep re-starting until a sign begins). */
  arm(): void {
    if (this.handle) return;
    this.begin();
    this.schedule();
  }

  private begin() {
    this.handle = this.factory(this.stream);
    this.startedAt = this.now();
  }

  private schedule() {
    this.timer = this.setTimer(() => {
      this.handle?.cancel();
      this.begin();
      this.schedule();
    }, this.preroll);
  }

  /** A sign has started: stop re-starting so the recording keeps the whole sign. */
  signStarted(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  /** Hands left or the sign was discarded: throw the footage away. */
  disarm(): void {
    this.signStarted();
    this.handle?.cancel();
    this.handle = null;
  }

  /** The sign ended: take the clip. The recorder detaches immediately, so a following disarm() is harmless. */
  async finish(): Promise<ClipResult | null> {
    this.signStarted();
    const handle = this.handle;
    if (!handle) return null;
    this.handle = null;
    const durationMs = this.now() - this.startedAt;
    const blob = await handle.stop();
    return blob.size ? { blob, mime: CLIP_MIME, durationMs } : null;
  }
}
