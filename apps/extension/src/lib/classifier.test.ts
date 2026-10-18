import { describe, expect, it } from 'vitest';
import model from '../../public/models/signclf.json';
import golden from './classifier.golden.json';
import {
  classify,
  featurize,
  logits,
  softmax,
  toGrid,
  toSlots,
  type ClassifierModel,
  type SlotFrame,
} from './classifier';
import type { Hand, LandmarkFrame } from './landmarks';

const M = model as ClassifierModel;

const hand = (pts: number[][]): Hand => ({
  landmarks: pts.map(([x, y, z]) => ({ x: x!, y: y!, z: z! })),
  handedness: 'Unknown',
});

/** The golden file's raw arrays as the frames the classifier takes. */
function framesOf(c: (typeof golden)[number]): SlotFrame[] {
  return c.pts.map((slots, t) => [
    c.seen[t]![0] ? hand(slots[0]!) : null,
    c.seen[t]![1] ? hand(slots[1]!) : null,
  ]);
}

describe('classifier parity with the PyTorch model (synthetic golden inputs)', () => {
  golden.forEach((c, i) => {
    it(`case ${i}: same features and same logits`, () => {
      const f = featurize(framesOf(c), c.w / c.h)!;
      const expected = c.features.flat();
      expect(f.length).toBe(expected.length);
      let worst = 0;
      f.forEach((v, k) => (worst = Math.max(worst, Math.abs(v - expected[k]!))));
      expect(worst).toBeLessThan(2e-3);
      const lg = logits(M, f);
      lg.forEach((v, k) => expect(Math.abs(v - c.logits[k]!)).toBeLessThan(5e-3));
    });
  });
});

describe('classify', () => {
  it('gives one of the 40 signs with a confidence between 0 and 1', () => {
    const c = golden[0]!;
    const r = classify(M, framesOf(c), c.w / c.h)!;
    expect(M.signs).toContain(r.sign);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it('also reports the three best guesses, how many frames it saw, and how many hands', () => {
    const c = golden[0]!;
    const frames = framesOf(c);
    const r = classify(M, frames, c.w / c.h)!;
    expect(r.top).toHaveLength(3);
    expect(r.top[0]).toEqual({ sign: r.sign, confidence: r.confidence });
    expect(r.top[0]!.confidence).toBeGreaterThanOrEqual(r.top[1]!.confidence);
    expect(r.top[1]!.confidence).toBeGreaterThanOrEqual(r.top[2]!.confidence);
    expect(new Set(r.top.map((t) => t.sign)).size).toBe(3);
    expect(r.frames).toBe(frames.filter((f) => f[0] || f[1]).length);
    const most = Math.max(...frames.map((f) => (f[0] ? 1 : 0) + (f[1] ? 1 : 0)));
    expect(r.hands).toBe(most);
  });

  it('refuses a sign with fewer than 4 frames showing a hand', () => {
    const c = golden[0]!;
    expect(classify(M, framesOf(c).slice(0, 3), 1.33)).toBeNull();
    expect(classify(M, [], 1.33)).toBeNull();
  });

  it('softmax sums to one', () => {
    expect(softmax([1, 2, 3]).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe('frame preparation', () => {
  const h = (x: number): Hand =>
    hand(Array.from({ length: 21 }, (_, i) => [x + i * 0.001, 0.5, 0]));

  it('orders hands left to right and keeps a lone hand in slot 0', () => {
    const [a, b] = toSlots([h(0.7), h(0.2)]);
    expect(a!.landmarks[0]!.x).toBeCloseTo(0.2);
    expect(b!.landmarks[0]!.x).toBeCloseTo(0.7);
    expect(toSlots([h(0.7)])[1]).toBeNull();
    expect(toSlots([h(0.7)])[0]).not.toBeNull();
  });

  it('puts irregular live frames on the 15 fps training grid, only inside the sign span', () => {
    const frames: LandmarkFrame[] = [0, 20, 90, 130, 400, 700, 1500].map((t) => ({
      t,
      hands: [h(t / 2000)],
    }));
    const grid = toGrid(frames, 20, 700);
    // 20 ms .. 700 ms at 66.7 ms steps -> 11 grid points
    expect(grid.length).toBe(11);
    expect(grid.every((f) => f[0] !== null)).toBe(true);
    expect(toGrid(frames, 5000, 6000)).toEqual([]);
  });
});
