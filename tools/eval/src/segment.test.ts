import { describe, expect, it } from 'vitest';
import { makeFrames } from '../../../apps/extension/src/testing/fixtures.js';
import { DEFAULT_SEGMENTER } from '../../../apps/extension/src/lib/segmenter.js';
import { analyse, formatAnalysis } from './segment.js';

describe('segmentation replay', () => {
  const recording = makeFrames([
    { kind: 'still', ms: 300 },
    { kind: 'move', ms: 1200 },
    { kind: 'still', ms: 700 },
    { kind: 'move', ms: 1000 },
    { kind: 'still', ms: 700 },
    { kind: 'none', ms: 2200 },
  ]);

  it('finds the signs, their timing and one pause, relative to the first frame', () => {
    const a = analyse(recording);
    expect(a.signs).toHaveLength(2);
    expect(a.signs[0]!.startMs).toBeGreaterThan(250);
    expect(a.signs[0]!.durationMs).toBeGreaterThan(1000);
    expect(a.pauses).toBe(1);
    expect(a.speed.max).toBeGreaterThan(a.speed.p10);
  });

  it('changing thresholds changes the outcome (that is what tuning is for)', () => {
    expect(analyse(recording, { ...DEFAULT_SEGMENTER, startSpeed: 99 }).signs).toHaveLength(0);
    expect(analyse(recording, { ...DEFAULT_SEGMENTER, holdMs: 1500 }).signs.length).toBeLessThan(2);
    expect(
      analyse(recording, { ...DEFAULT_SEGMENTER, minMs: 1500 }).discards.length,
    ).toBeGreaterThan(0);
  });

  it('prints a readable summary with tuning hints', () => {
    const text = formatAnalysis(analyse(recording), DEFAULT_SEGMENTER);
    expect(text).toMatch(/2 sign\(s\), 0 discarded, 1 pause/);
    expect(text).toMatch(/Tuning hints/);
  });
});
