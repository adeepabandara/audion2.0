/**
 * Web Audio mixer behind the outgoing Meet microphone track.
 *
 *   real mic -> micGain --\
 *                          +-> bus -> destination (this is the track Meet sends) ; bus -> analyser (level probe)
 *   Audion voice -> voiceGain /
 *
 * The real microphone always passes through (so a signer who can speak still can). Audion's voice is added
 * only while enabled and not muted.
 */
export interface GainLike {
  gain: { value: number };
  connect(to: unknown): unknown;
  disconnect(): void;
}
export interface SourceLike {
  connect(to: unknown): unknown;
  disconnect(): void;
}
export interface BufferSourceLike extends SourceLike {
  buffer: unknown;
  onended: ((...args: never[]) => unknown) | null;
  start(): void;
  stop(): void;
}
export interface AnalyserLike {
  fftSize: number;
  getByteTimeDomainData(a: Uint8Array): void;
}

export interface MixerContext {
  state: string;
  /** The device's speakers, used only for the local monitor copy of Ola's voice. */
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  decodeAudioData(b: ArrayBuffer): Promise<unknown>;
  createMediaStreamDestination(): { stream: MediaStream };
  createMediaStreamSource(s: MediaStream): SourceLike;
  createGain(): GainLike;
  createAnalyser(): AnalyserLike;
  createBufferSource(): BufferSourceLike;
}

export type PlayResult = 'done' | 'disabled' | 'muted';

export class Mixer {
  readonly stream: MediaStream;
  private readonly micGain: GainLike;
  private readonly voiceGain: GainLike;
  private readonly bus: GainLike;
  private readonly analyser: AnalyserLike;
  private readonly micSource: SourceLike | null;
  private enabled = true;
  private muted = false;
  private playing = new Set<BufferSourceLike>();
  private disposed = false;

  constructor(
    private readonly ctx: MixerContext,
    realMic: MediaStream | null,
  ) {
    const dest = ctx.createMediaStreamDestination();
    this.stream = dest.stream;
    this.bus = ctx.createGain();
    this.micGain = ctx.createGain();
    this.voiceGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.micGain.connect(this.bus);
    this.voiceGain.connect(this.bus);
    this.bus.connect(dest);
    this.bus.connect(this.analyser);
    this.micSource =
      realMic && realMic.getAudioTracks().length ? ctx.createMediaStreamSource(realMic) : null;
    this.micSource?.connect(this.micGain);
  }

  get hasMic(): boolean {
    return this.micSource !== null;
  }

  configure(opts: { enabled?: boolean; voiceMuted?: boolean }): void {
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.voiceMuted !== undefined) this.muted = opts.voiceMuted;
    // Silence anything already playing the moment Audion is switched off or muted.
    this.voiceGain.gain.value = this.enabled && !this.muted ? 1 : 0;
    if (this.voiceGain.gain.value === 0) this.stopAll();
  }

  /**
   * Decode and play Ola's voice into the call. Resolves when it has finished. With `monitor`, the same audio is
   * also played on this device's speakers, so the signer hears what the call hears (Meet never plays your own
   * microphone back to you). Use headphones to avoid the microphone picking it up again.
   */
  async play(bytes: ArrayBuffer, opts: { monitor?: boolean } = {}): Promise<PlayResult> {
    if (!this.enabled) return 'disabled';
    if (this.muted) return 'muted';
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const buffer = await this.ctx.decodeAudioData(bytes);
    if (!this.enabled) return 'disabled';
    if (this.muted) return 'muted';
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.voiceGain);
    let monitorGain: GainLike | null = null;
    if (opts.monitor) {
      monitorGain = this.ctx.createGain();
      src.connect(monitorGain);
      monitorGain.connect(this.ctx.destination);
    }
    this.playing.add(src);
    return new Promise<PlayResult>((resolve) => {
      src.onended = () => {
        this.playing.delete(src);
        monitorGain?.disconnect();
        resolve('done');
      };
      src.start();
    });
  }

  /** Peak of the mixed output, 0..1 (0 = silence). */
  peak(): number {
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let max = 0;
    for (const v of data) max = Math.max(max, Math.abs(v - 128));
    return max / 128;
  }

  private stopAll() {
    for (const s of this.playing) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.playing.clear();
  }

  /** Safe to call more than once: Meet can stop the same track twice, and closing a closed context throws. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
    this.micSource?.disconnect();
    void this.ctx.close().catch(() => {});
  }
}
