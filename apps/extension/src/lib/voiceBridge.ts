import {
  CONTENT_SOURCE,
  isFromInject,
  isSameWindowMessage,
  type FromInject,
  type SpeakResult,
  type ToInject,
} from './voiceProtocol';

export interface Probe {
  hasChannel: boolean;
  micMuted: boolean;
  peak: number;
}

export interface VoiceChannel {
  speak(audio: Uint8Array, opts?: { monitor?: boolean }): Promise<SpeakResult>;
  configure(opts: { enabled: boolean; voiceMuted: boolean }): void;
  onChannel(cb: (s: { hasChannel: boolean; micMuted: boolean }) => void): () => void;
  /** After each spoken sentence: did it reach the call's outgoing audio (true), not (false), or unknown (null)? */
  onDelivery(cb: (sent: boolean | null) => void): () => void;
  probe(): Promise<Probe>;
  dispose(): void;
}

/** Content-script side of the voice channel: talks to the MAIN-world inject script. */
export class VoiceBridge implements VoiceChannel {
  private nextId = 1;
  private pending = new Map<number, (m: FromInject) => void>();
  private listeners = new Set<(s: { hasChannel: boolean; micMuted: boolean }) => void>();
  private deliveryListeners = new Set<(sent: boolean | null) => void>();
  private readonly onMessage = (e: MessageEvent) => {
    if (!isSameWindowMessage(e, this.win) || !isFromInject(e.data)) return;
    const m = e.data;
    if (m.type === 'channel') this.listeners.forEach((l) => l(m));
    else if (m.type === 'speak-result' || m.type === 'probe-result') {
      this.pending.get(m.id)?.(m);
      if (m.type === 'speak-result' && m.sent !== undefined) {
        this.deliveryListeners.forEach((l) => l(m.sent ?? null));
      }
    }
  };

  constructor(
    private readonly win: Window = window,
    private readonly timeoutMs = 120_000,
  ) {
    win.addEventListener('message', this.onMessage);
  }

  private post(msg: ToInject, transfer: Transferable[] = []) {
    this.win.postMessage(msg, this.win.location.origin, transfer);
  }

  private request<T extends FromInject>(
    make: (id: number) => ToInject,
    transfer: Transferable[],
    fallback: T,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => (this.pending.delete(id), resolve(fallback)), this.timeoutMs);
      this.pending.set(id, (m) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(m as T);
      });
      this.post(make(id), transfer);
    });
  }

  async speak(audio: Uint8Array, opts: { monitor?: boolean } = {}): Promise<SpeakResult> {
    const buf = audio.buffer.slice(
      audio.byteOffset,
      audio.byteOffset + audio.byteLength,
    ) as ArrayBuffer;
    const res = await this.request<Extract<FromInject, { type: 'speak-result' }>>(
      (id) => ({
        source: CONTENT_SOURCE,
        type: 'speak',
        id,
        audio: buf,
        monitor: opts.monitor === true,
      }),
      [buf],
      { source: 'audion-inject', type: 'speak-result', id: -1, result: 'error' },
    );
    return res.result;
  }

  configure(opts: { enabled: boolean; voiceMuted: boolean }): void {
    this.post({ source: CONTENT_SOURCE, type: 'config', ...opts });
  }

  onChannel(cb: (s: { hasChannel: boolean; micMuted: boolean }) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onDelivery(cb: (sent: boolean | null) => void): () => void {
    this.deliveryListeners.add(cb);
    return () => this.deliveryListeners.delete(cb);
  }

  async probe(): Promise<Probe> {
    const res = await this.request<Extract<FromInject, { type: 'probe-result' }>>(
      (id) => ({ source: CONTENT_SOURCE, type: 'probe', id }),
      [],
      {
        source: 'audion-inject',
        type: 'probe-result',
        id: -1,
        hasChannel: false,
        micMuted: false,
        peak: 0,
      },
    );
    return { hasChannel: res.hasChannel, micMuted: res.micMuted, peak: res.peak };
  }

  dispose(): void {
    this.win.removeEventListener('message', this.onMessage);
    this.pending.clear();
    this.listeners.clear();
    this.deliveryListeners.clear();
  }
}
