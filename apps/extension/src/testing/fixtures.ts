import type { Hand, LandmarkFrame, Point } from '../lib/landmarks';

/**
 * Synthetic landmark recordings for segmenter tests. They stand in for real recordings until we have consented
 * ones (never commit video): a hand of known size that is absent, still (with sensor jitter) or oscillating.
 */
export type Segment =
  | { kind: 'none'; ms: number }
  | { kind: 'still'; ms: number }
  | { kind: 'move'; ms: number; amplitude?: number; hz?: number }
  | { kind: 'drop'; ms: number };

export const FPS = 15;
const SCALE = 0.15; // wrist -> middle knuckle, in frame widths

export function makeHand(cx = 0.5, cy = 0.6, handedness: Hand['handedness'] = 'Right'): Hand {
  const lm: Point[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  lm[0] = { x: cx, y: cy, z: 0 };
  lm[9] = { x: cx, y: cy - SCALE, z: 0 };
  [4, 8, 12, 16, 20].forEach(
    (i, k) => (lm[i] = { x: cx + (k - 2) * 0.03, y: cy - SCALE * 1.6, z: 0 }),
  );
  return { landmarks: lm, handedness };
}

/** Deterministic pseudo-noise so fixtures are repeatable. */
const noise = (i: number) => Math.sin(i * 12.9898) * 0.5;

export function makeFrames(segments: Segment[], startT = 0): LandmarkFrame[] {
  const frames: LandmarkFrame[] = [];
  const dt = 1000 / FPS;
  let t = startT;
  let i = 0;
  let phase = 0;
  for (const seg of segments) {
    const n = Math.round(seg.ms / dt);
    for (let k = 0; k < n; k++, i++, t += dt) {
      if (seg.kind === 'none' || seg.kind === 'drop') {
        frames.push({ t, hands: [] });
      } else if (seg.kind === 'still') {
        frames.push({ t, hands: [makeHand(0.5 + noise(i) * 0.0008, 0.6 + noise(i + 7) * 0.0008)] });
      } else {
        const amp = seg.amplitude ?? 0.05;
        const hz = seg.hz ?? 2;
        phase += (2 * Math.PI * hz) / FPS;
        frames.push({ t, hands: [makeHand(0.5 + amp * Math.sin(phase), 0.6)] });
      }
    }
  }
  return frames;
}
