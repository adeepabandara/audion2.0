// On-device sign classifier: hand points (and, for a model trained with them, body points) in, one of the model's
// signs out, in a few milliseconds, with no network call.
// The feature code mirrors tools/signclf/features.py number for number (classifier.test.ts checks them against a
// golden file made by the PyTorch model); the network is a 1-layer GRU + a linear layer, written out by hand so
// there is no library to ship. The weights are public/models/signclf.json (made by tools/signclf/train.py).
import type { BodyPoint, Hand, LandmarkFrame } from './landmarks';

export const STEPS = 48;
export const FEATURES = 132;
/** Body numbers per frame for a model trained with `--pose` (features.py `featurize_pose`). */
export const POSE_FEATURES = 12;
const WRIST = 0;
const MIDDLE_MCP = 9;
const INDEX_TIP = 8;
const NOSE = 0;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
/** The training clips were sampled at 15 fps, so live frames are put on the same grid first. */
const GRID_MS = 1000 / 15;

export interface ClassifierModel {
  signs: string[];
  steps: number;
  features: number;
  hidden: number;
  /** True when the model also takes the 12 body numbers per frame (then `features` is 144). */
  pose?: boolean;
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
  /** The three most likely signs, best first (the first is `sign`): what else the model was considering. */
  top: Array<{ sign: string; confidence: number }>;
  /** How many frames with a hand it had to go on: a very short count means a cut-off or very quick sign. */
  frames: number;
  /** The most hands in view at once. A resting second hand in the picture changes what one-handed signs look like. */
  hands: number;
}

/** One frame: up to two hands, ordered left to right in the image (a lone hand is slot 0). */
export type SlotFrame = [Hand | null, Hand | null];
/** One frame's body points (33 MediaPipe Pose landmarks), or null when no person was found. */
export type PoseFrame = BodyPoint[] | null;

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
  return onGrid(frames, startT, endT).map((f) => toSlots(f.hands));
}

/** The body points on the same grid as `toGrid` (same frames, same order). */
export function poseGrid(frames: LandmarkFrame[], startT: number, endT: number): PoseFrame[] {
  return onGrid(frames, startT, endT).map((f) => f.pose ?? null);
}

function onGrid(frames: LandmarkFrame[], startT: number, endT: number): LandmarkFrame[] {
  const inSpan = frames.filter((f) => f.t >= startT && f.t <= endT);
  if (inSpan.length === 0) return [];
  const out: LandmarkFrame[] = [];
  let j = 0;
  for (let t = inSpan[0]!.t; t <= inSpan[inSpan.length - 1]!.t; t += GRID_MS) {
    while (j + 1 < inSpan.length && Math.abs(inSpan[j + 1]!.t - t) <= Math.abs(inSpan[j]!.t - t))
      j++;
    out.push(inSpan[j]!);
  }
  return out;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * Per-sign nose, shoulder centre and shoulder width (medians over the frames where both shoulders are visible), x
 * scaled by the aspect like the hands. Null when the shoulders are never seen. Mirrors features.py `anchors`.
 */
function anchors(pose: PoseFrame[], aspect: number) {
  const ok = pose.filter(
    (p): p is BodyPoint[] =>
      !!p && (p[L_SHOULDER]?.visibility ?? 0) > 0.5 && (p[R_SHOULDER]?.visibility ?? 0) > 0.5,
  );
  if (ok.length === 0) return null;
  const xy = (p: BodyPoint) => [p.x * aspect, p.y] as const;
  const nose = ok.map((p) => xy(p[NOSE]!));
  const centre = ok.map((p) => {
    const l = xy(p[L_SHOULDER]!);
    const r = xy(p[R_SHOULDER]!);
    return [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2] as const;
  });
  const width = ok.map((p) => {
    const l = xy(p[L_SHOULDER]!);
    const r = xy(p[R_SHOULDER]!);
    return Math.hypot(l[0] - r[0], l[1] - r[1]);
  });
  return {
    nose: [median(nose.map((v) => v[0])), median(nose.map((v) => v[1]))] as const,
    centre: [median(centre.map((v) => v[0])), median(centre.map((v) => v[1]))] as const,
    width: Math.max(median(width), 0.05),
  };
}

/**
 * (STEPS x 132) features, or null when fewer than 4 frames have a hand. Mirrors features.py `featurize`. With `pose`
 * (one entry per frame, as `poseGrid` gives) each frame gets the 12 body numbers after its 132 (STEPS x 144), as
 * features.py `featurize_pose`: per hand slot, the wrist and the index fingertip from the nose and the wrist from the
 * middle of the shoulders, in shoulder widths; zeros for a missing hand or when the shoulders are never seen.
 */
export function featurize(
  frames: SlotFrame[],
  aspect: number,
  steps = STEPS,
  pose?: PoseFrame[],
): Float32Array | null {
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
  const med = Math.max(sizes.length === 0 ? 0.1 : median(sizes), 0.02);
  const cx = nWrist ? sx / nWrist : 0;
  const cy = nWrist ? sy / nWrist : 0;

  const width = pose ? FEATURES + POSE_FEATURES : FEATURES;
  const anc = pose ? anchors(pose.slice(first, last + 1), aspect) : null;
  const out = new Float32Array(steps * width);
  for (let s = 0; s < steps; s++) {
    const f = span[Math.min(Math.floor((s * span.length) / steps), span.length - 1)]!;
    for (let slot = 0; slot < 2; slot++) {
      const h = f[slot];
      if (!h) continue;
      if (anc) {
        const w = at(h, WRIST);
        const tip = at(h, INDEX_TIP);
        const b = s * width + FEATURES + slot * 6;
        out[b] = (w[0] - anc.nose[0]) / anc.width;
        out[b + 1] = (w[1] - anc.nose[1]) / anc.width;
        out[b + 2] = (tip[0] - anc.nose[0]) / anc.width;
        out[b + 3] = (tip[1] - anc.nose[1]) / anc.width;
        out[b + 4] = (w[0] - anc.centre[0]) / anc.width;
        out[b + 5] = (w[1] - anc.centre[1]) / anc.width;
      }
      const base = s * width + slot * 66;
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

/** Logits for one (STEPS x model.features) input: PyTorch GRU (gates stacked reset, update, new) then the linear layer. */
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

/** What the tracker page sends back: the guess, plus (when known) what the model saw. */
export type DeviceAnswer = Pick<Classified, 'sign' | 'confidence'> &
  Partial<Pick<Classified, 'top' | 'frames' | 'hands'>> & { threshold: number };

/**
 * The model's best guess and its confidence; null when there is too little to go on (under 4 frames with hands).
 * `pose` (from `poseGrid`) is used only by a model trained with body points; without it such a model gets zeros.
 */
export function classify(
  model: ClassifierModel,
  frames: SlotFrame[],
  aspect: number,
  pose?: PoseFrame[],
): Classified | null {
  const x = featurize(
    frames,
    aspect,
    model.steps,
    model.pose ? (pose ?? frames.map(() => null)) : undefined,
  );
  if (!x) return null;
  const p = softmax(logits(model, x));
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const [bestP, best] = order[0]!;
  const seen = frames.filter((f) => f[0] !== null || f[1] !== null);
  return {
    sign: model.signs[best]!,
    confidence: bestP,
    top: order.slice(0, 3).map(([v, i]) => ({ sign: model.signs[i]!, confidence: v })),
    frames: seen.length,
    hands: seen.reduce((m, f) => Math.max(m, (f[0] ? 1 : 0) + (f[1] ? 1 : 0)), 0),
  };
}
