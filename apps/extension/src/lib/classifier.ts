// On-device sign classifier: hand points in, one of the 22 signs out, in a few milliseconds, with no network call.
// The feature code mirrors tools/signclf/features.py number for number (classifier.test.ts checks them against a
// golden file made by the PyTorch model); the network is a 1-layer GRU + a linear layer, written out by hand so
// there is no library to ship. The weights are public/models/signclf.json (made by tools/signclf/train.py).
import type { Hand, LandmarkFrame } from './landmarks';

export const STEPS = 32;
export const FEATURES = 132;
const WRIST = 0;
const MIDDLE_MCP = 9;
/** The training clips were sampled at 15 fps, so live frames are put on the same grid first. */
const GRID_MS = 1000 / 15;

export interface ClassifierModel {
  signs: string[];
  steps: number;
  features: number;
  hidden: number;
  /** Answer from the device only at or above this softmax confidence; below it the cloud decides. */
  threshold: number;
  wIh: number[][];
  wHh: number[][];
  bIh: number[];
  bHh: number[];
  wOut: number[][];
  bOut: number[];
}

export interface Classified {
  sign: string;
  confidence: number;
}

/** One frame: up to two hands, ordered left to right in the image (a lone hand is slot 0). */
export type SlotFrame = [Hand | null, Hand | null];

export function toSlots(hands: Hand[]): SlotFrame {
  const sorted = [...hands]
    .sort((a, b) => (a.landmarks[WRIST]?.x ?? 0) - (b.landmarks[WRIST]?.x ?? 0))
    .slice(0, 2);
  return [sorted[0] ?? null, sorted[1] ?? null];
}

/**
 * Landmark frames (any timing) -> the uniform 15 fps grid the model was trained on, keeping the frames in the time
 * span between `startT` and `endT`. Each grid time takes the nearest frame.
 */
export function toGrid(frames: LandmarkFrame[], startT: number, endT: number): SlotFrame[] {
  const inSpan = frames.filter((f) => f.t >= startT && f.t <= endT);
  if (inSpan.length === 0) return [];
  const out: SlotFrame[] = [];
  let j = 0;
  for (let t = inSpan[0]!.t; t <= inSpan[inSpan.length - 1]!.t; t += GRID_MS) {
    while (j + 1 < inSpan.length && Math.abs(inSpan[j + 1]!.t - t) <= Math.abs(inSpan[j]!.t - t))
      j++;
    out.push(toSlots(inSpan[j]!.hands));
  }
  return out;
}

/** (STEPS x 132) features, or null when fewer than 4 frames have a hand. Mirrors features.py `featurize`. */
export function featurize(frames: SlotFrame[], aspect: number, steps = STEPS): Float32Array | null {
  const seenAny = frames.map((f) => f[0] !== null || f[1] !== null);
  const first = seenAny.indexOf(true);
  const last = seenAny.lastIndexOf(true);
  if (first < 0 || last + 1 - first < 4) return null;
  const span = frames.slice(first, last + 1);

  const at = (h: Hand, i: number) => {
    const p = h.landmarks[i]!;
    return [p.x * aspect, p.y, p.z * aspect] as const;
  };
  const sizes: number[] = [];
  let sx = 0;
  let sy = 0;
  let nWrist = 0;
  for (const f of span) {
    for (const h of f) {
      if (!h) continue;
      const w = at(h, WRIST);
      const m = at(h, MIDDLE_MCP);
      const size = Math.hypot(m[0] - w[0], m[1] - w[1]);
      if (size > 1e-4) sizes.push(size);
      sx += w[0];
      sy += w[1];
      nWrist++;
    }
  }
  sizes.sort((a, b) => a - b);
  const mid = sizes.length >> 1;
  const median =
    sizes.length === 0 ? 0.1 : sizes.length % 2 ? sizes[mid]! : (sizes[mid - 1]! + sizes[mid]!) / 2;
  const med = Math.max(median, 0.02);
  const cx = nWrist ? sx / nWrist : 0;
  const cy = nWrist ? sy / nWrist : 0;

  const out = new Float32Array(steps * FEATURES);
  for (let s = 0; s < steps; s++) {
    const f = span[Math.min(Math.floor((s * span.length) / steps), span.length - 1)]!;
    for (let slot = 0; slot < 2; slot++) {
      const h = f[slot];
      if (!h) continue;
      const base = s * FEATURES + slot * 66;
      const w = at(h, WRIST);
      for (let i = 0; i < 21; i++) {
        const p = at(h, i);
        out[base + i * 3] = (p[0] - w[0]) / med;
        out[base + i * 3 + 1] = (p[1] - w[1]) / med;
        out[base + i * 3 + 2] = (p[2] - w[2]) / med;
      }
      out[base + 63] = (w[0] - cx) / med;
      out[base + 64] = (w[1] - cy) / med;
      out[base + 65] = 1;
    }
  }
  return out;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function matVec(
  w: number[][],
  x: ArrayLike<number>,
  offset: number,
  rows: number,
  b: number[],
  bOff: number,
) {
  const out = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = w[offset + r]!;
    let sum = b[bOff + r]!;
    for (let c = 0; c < row.length; c++) sum += row[c]! * x[c]!;
    out[r] = sum;
  }
  return out;
}

/** Logits for one (STEPS x 132) input: PyTorch GRU (gates stacked reset, update, new) then the linear layer. */
export function logits(model: ClassifierModel, x: Float32Array): number[] {
  const H = model.hidden;
  let h = new Float64Array(H);
  for (let s = 0; s < model.steps; s++) {
    const xs = x.subarray(s * model.features, (s + 1) * model.features);
    const r = matVec(model.wIh, xs, 0, H, model.bIh, 0);
    const z = matVec(model.wIh, xs, H, H, model.bIh, H);
    const n = matVec(model.wIh, xs, 2 * H, H, model.bIh, 2 * H);
    const hr = matVec(model.wHh, h, 0, H, model.bHh, 0);
    const hz = matVec(model.wHh, h, H, H, model.bHh, H);
    const hn = matVec(model.wHh, h, 2 * H, H, model.bHh, 2 * H);
    const next = new Float64Array(H);
    for (let i = 0; i < H; i++) {
      const rg = sigmoid(r[i]! + hr[i]!);
      const zg = sigmoid(z[i]! + hz[i]!);
      const ng = Math.tanh(n[i]! + rg * hn[i]!);
      next[i] = (1 - zg) * ng + zg * h[i]!;
    }
    h = next;
  }
  return Array.from(matVec(model.wOut, h, 0, model.signs.length, model.bOut, 0));
}

export function softmax(l: number[]): number[] {
  const m = Math.max(...l);
  const e = l.map((v) => Math.exp(v - m));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

/** The model's best guess and its confidence; null when there is too little to go on (under 4 frames with hands). */
export function classify(
  model: ClassifierModel,
  frames: SlotFrame[],
  aspect: number,
): Classified | null {
  const x = featurize(frames, aspect, model.steps);
  if (!x) return null;
  const p = softmax(logits(model, x));
  let best = 0;
  p.forEach((v, i) => {
    if (v > p[best]!) best = i;
  });
  return { sign: model.signs[best]!, confidence: p[best]! };
}
