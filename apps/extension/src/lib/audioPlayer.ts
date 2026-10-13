let ctx: AudioContext | undefined;

export interface Playback {
  /** Resolves when playback ends or is stopped. */
  done: Promise<void>;
  stop(): void;
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
  src.start();
  return { done, stop: () => src.stop() };
}
