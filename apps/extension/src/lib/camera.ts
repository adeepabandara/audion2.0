export type CameraProblem = 'blocked' | 'busy' | 'missing' | 'unknown';

/** Map getUserMedia failures to something a person can act on. */
export function classifyMediaError(err: unknown): CameraProblem {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  return 'unknown';
}

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  audio: false,
};

/** Mean luma (0-255) of RGBA pixels, Rec. 601 weights. */
export function meanLuminance(rgba: Uint8ClampedArray | Uint8Array): number {
  let sum = 0;
  const px = rgba.length / 4;
  if (px === 0) return 0;
  for (let i = 0; i < rgba.length; i += 4) {
    sum += 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
  }
  return sum / px;
}

export const LOW_LIGHT_THRESHOLD = 60;

export type Lighting = 'dark' | 'ok';

export function lightingFrom(mean: number): Lighting {
  return mean < LOW_LIGHT_THRESHOLD ? 'dark' : 'ok';
}

/** Sample the current video frame on a tiny canvas. Returns null until the video has data. */
export function sampleVideoLuminance(video: HTMLVideoElement): number | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 24;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, 32, 24);
  return meanLuminance(ctx.getImageData(0, 0, 32, 24).data);
}

/** Record `ms` of the stream into memory. The Blob is never persisted. */
export function recordClip(
  stream: MediaStream,
  ms: number,
): Promise<{ blob: Blob; mime: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    if (!mime) return reject(new Error('This browser cannot record video.'));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 800_000 });
    const chunks: Blob[] = [];
    const started = performance.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onerror = () => reject(new Error('Recording failed.'));
    rec.onstop = () =>
      resolve({
        blob: new Blob(chunks, { type: 'video/webm' }),
        mime: 'video/webm',
        durationMs: performance.now() - started,
      });
    rec.start(250);
    setTimeout(() => rec.state !== 'inactive' && rec.stop(), ms);
  });
}
