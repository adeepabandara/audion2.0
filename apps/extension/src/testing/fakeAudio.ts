import type {
  AnalyserLike,
  BufferSourceLike,
  GainLike,
  MixerContext,
  SourceLike,
} from '../lib/audioMixer';

/** Minimal Web Audio + MediaStream fakes (jsdom has neither). Edges record how the graph is wired. */
export class FakeTrack {
  private on = true;
  stopped = false;
  constructor(
    public kind: 'audio' | 'video' = 'audio',
    public label = 'Fake mic',
  ) {}
  get enabled() {
    return this.on;
  }
  set enabled(v: boolean) {
    this.on = v;
  }
  stop() {
    this.stopped = true;
  }
  getSettings() {
    return { deviceId: 'real-mic', label: this.label };
  }
}

export class FakeStream {
  constructor(public tracks: FakeTrack[] = []) {}
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  getTracks() {
    return this.tracks;
  }
}

class Node {
  constructor(
    public name: string,
    private edges: Array<[string, string]>,
  ) {}
  connect(to: unknown) {
    this.edges.push([this.name, (to as Node).name]);
    return to;
  }
  disconnect() {}
}

export function makeFakeContext() {
  const edges: Array<[string, string]> = [];
  const gains: Record<string, { value: number }> = {};
  let gainN = 0;
  const analyserData = { fill: 128 };
  const ctx = {
    state: 'running',
    destination: new Node('speakers', edges),
    closed: false,
    resumed: 0,
    decoded: [] as ArrayBuffer[],
    played: 0,
    async resume() {
      ctx.resumed++;
      ctx.state = 'running';
    },
    async close() {
      ctx.closed = true;
    },
    async decodeAudioData(b: ArrayBuffer) {
      ctx.decoded.push(b);
      return { fake: 'buffer' };
    },
    createMediaStreamDestination() {
      const stream = new FakeStream([new FakeTrack('audio', 'Audion mix')]);
      return Object.assign(new Node('dest', edges), { stream: stream as unknown as MediaStream });
    },
    createMediaStreamSource(): SourceLike {
      return new Node('micSource', edges);
    },
    createGain(): GainLike {
      // Gains are created in a fixed order by Mixer: bus, micGain, voiceGain; then one monitorGain per monitored play.
      const name = ['bus', 'micGain', 'voiceGain', 'monitorGain'][gainN++] ?? `monitorGain${gainN}`;
      const node = new Node(name, edges) as unknown as GainLike;
      node.gain = gains[name] = { value: 1 };
      return node;
    },
    createAnalyser(): AnalyserLike & Node {
      const n = new Node('analyser', edges) as Node & AnalyserLike;
      n.fftSize = 0;
      n.getByteTimeDomainData = (a: Uint8Array) => a.fill(analyserData.fill);
      return n;
    },
    createBufferSource(): BufferSourceLike {
      const n = new Node('voice', edges) as unknown as BufferSourceLike;
      n.buffer = null;
      n.onended = null;
      n.start = () => {
        ctx.played++;
        queueMicrotask(() => (n.onended as (() => void) | null)?.());
      };
      n.stop = () => (n.onended as (() => void) | null)?.();
      return n;
    },
  };
  return { ctx: ctx as unknown as MixerContext & typeof ctx, edges, gains, analyserData };
}
