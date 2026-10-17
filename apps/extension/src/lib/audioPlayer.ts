let ctx: AudioContext | undefined;

export interface Playback {
  /** Resolves when playback ends or is stopped. */
  done: Promise<void>;
  stop(): void;
  /** Length of the sound in seconds. */
  duration: number;
  /** Seconds played so far (0 to duration). */
  elapsed(): number;
  /** How loud each slice of the sound is (0 to 1), about 56 slices, for drawing its shape. */
  peaks: number[];
}

/** The loudness of `count` equal slices of the first channel, scaled so the loudest is 1. */
export function peaksOf(data: Float32Array, count = 56): number[] {
  const size = Math.max(1, Math.floor(data.length / count));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let max = 0;
    for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j++) {
      const v = Math.abs(data[j]!);
      if (v > max) max = v;
    }
    out.push(max);
  }
  const top = Math.max(...out, 1e-6);
  return out.map((v) => v / top);
}

/** Decode (format sniffed, so WAV from mock mode and MP3 from live both work) and play through the speakers. */
export async function playAudio(bytes: Uint8Array): Promise<Playback> {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const buffer = await ctx.decodeAudioData(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  const done = new Promise<void>((resolve) => (src.onended = () => resolve()));
  const startedAt = ctx.currentTime;
  src.start();
  return {
    done,
    stop: () => src.stop(),
    duration: buffer.duration,
    elapsed: () => Math.min(buffer.duration, Math.max(0, ctx!.currentTime - startedAt)),
    peaks: peaksOf(buffer.getChannelData(0)),
  };
}
