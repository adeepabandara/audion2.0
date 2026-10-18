import { describe, expect, it } from 'vitest';
import { frameMotion, handsNearEdge } from './landmarks';
import { DEFAULT_SEGMENTER, runSegmenter, type SegmenterEvent } from './segmenter';
import { makeFrames, makeHand } from '../testing/fixtures';

const types = (ev: SegmenterEvent[]) => ev.map((e) => e.type);

describe('frameMotion', () => {
  it('is zero for a still hand, large for a moving one, and ignores stale gaps', () => {
    const a = { t: 0, hands: [makeHand(0.5, 0.6)] };
    expect(frameMotion(a, { t: 66, hands: [makeHand(0.5, 0.6)] })).toBe(0);
    expect(frameMotion(a, { t: 66, hands: [makeHand(0.55, 0.6)] })).toBeGreaterThan(3);
    expect(frameMotion(a, { t: 1000, hands: [makeHand(0.9, 0.6)] })).toBe(0);
    expect(frameMotion(null, a)).toBe(0);
    expect(frameMotion(a, { t: 66, hands: [] })).toBe(0);
  });

  it('is independent of how far the hand is from the camera', () => {
    // Same relative motion, hand drawn twice as big: speed in hand-sizes/s must match.
    const big = (cx: number) => {
      const h = makeHand(cx, 0.6);
      const s = (p: { x: number; y: number }) => ({
        ...p,
        x: 0.5 + (p.x - 0.5) * 2,
        y: 0.6 + (p.y - 0.6) * 2,
      });
      return { ...h, landmarks: h.landmarks.map((p) => ({ ...p, ...s(p) })) };
    };
    const small = frameMotion({ t: 0, hands: [makeHand(0.5)] }, { t: 66, hands: [makeHand(0.52)] });
    const large = frameMotion({ t: 0, hands: [big(0.5)] }, { t: 66, hands: [big(0.52)] });
    expect(large).toBeCloseTo(small, 1);
  });

  it('flags hands at the frame edge', () => {
    expect(handsNearEdge({ t: 0, hands: [makeHand(0.5, 0.6)] })).toBe(false);
    expect(handsNearEdge({ t: 0, hands: [makeHand(0.995, 0.6)] })).toBe(true);
  });
});

describe('segmenter', () => {
  it('turns one deliberate sign into start then end, then a pause after the hands leave', () => {
    const frames = makeFrames([
      { kind: 'none', ms: 500 },
      { kind: 'still', ms: 300 },
      { kind: 'move', ms: 1500 },
      { kind: 'still', ms: 700 },
      { kind: 'none', ms: 2000 },
    ]);
    const ev = runSegmenter(frames);
    expect(types(ev)).toEqual(['handsAppeared', 'signStart', 'signEnd', 'handsLeft', 'pause']);
    const end = ev.find((e) => e.type === 'signEnd');
    expect(end).toMatchObject({ reason: 'hold' });
    // Clip is about the 1.5 s of motion (end is where the rest began, not after the hold).
    const dur =
      (end as Extract<SegmenterEvent, { type: 'signEnd' }>).endT -
      (end as Extract<SegmenterEvent, { type: 'signEnd' }>).startT;
    expect(dur).toBeGreaterThan(1200);
    expect(dur).toBeLessThan(1800);
  });

  it('ignores a resting hand with sensor jitter', () => {
    const ev = runSegmenter(makeFrames([{ kind: 'still', ms: 5000 }]));
    expect(types(ev)).toEqual(['handsAppeared']);
  });

  it('discards signs shorter than 0.6 s with tooShort', () => {
    const ev = runSegmenter(
      makeFrames([
        { kind: 'still', ms: 300 },
        { kind: 'move', ms: 300 },
        { kind: 'still', ms: 800 },
      ]),
    );
    expect(ev.find((e) => e.type === 'signDiscarded')).toMatchObject({ reason: 'tooShort' });
    expect(types(ev)).not.toContain('signEnd');
  });

  it('discards signs longer than 6 s with tooLong, as soon as the limit passes, and needs a rest before the next', () => {
    const ev = runSegmenter(
      makeFrames([
        { kind: 'still', ms: 300 },
        { kind: 'move', ms: 8000 },
      ]),
    );
    const discards = ev.filter((e) => e.type === 'signDiscarded');
    expect(discards).toHaveLength(1);
    expect(discards[0]).toMatchObject({ reason: 'tooLong' });
    expect(types(ev).filter((x) => x === 'signStart')).toHaveLength(1); // no instant restart while still moving
  });

  it('ends a sign when the hands leave mid-motion', () => {
    const ev = runSegmenter(
      makeFrames([
        { kind: 'still', ms: 200 },
        { kind: 'move', ms: 1200 },
        { kind: 'none', ms: 2000 },
      ]),
    );
    expect(ev.find((e) => e.type === 'signEnd')).toMatchObject({ reason: 'handsLeft' });
  });

  it('is not split by a single missed detection', () => {
    const ev = runSegmenter(
      makeFrames([
        { kind: 'still', ms: 200 },
        { kind: 'move', ms: 600 },
        { kind: 'drop', ms: 70 },
        { kind: 'move', ms: 600 },
        { kind: 'still', ms: 700 },
      ]),
    );
    expect(types(ev).filter((x) => x === 'signStart')).toHaveLength(1);
    expect(types(ev).filter((x) => x === 'signEnd')).toHaveLength(1);
  });

  it('segments two signs separated by a rest, emitting one pause at the end', () => {
    const ev = runSegmenter(
      makeFrames([
        { kind: 'still', ms: 200 },
        { kind: 'move', ms: 1000 },
        { kind: 'still', ms: 700 },
        { kind: 'move', ms: 1000 },
        { kind: 'still', ms: 700 },
        { kind: 'none', ms: 3000 },
      ]),
    );
    expect(types(ev).filter((x) => x === 'signEnd')).toHaveLength(2);
    expect(types(ev).filter((x) => x === 'pause')).toHaveLength(1);
  });

  it('emits the pause even when the hands stay in view after the sign', () => {
    const ev = runSegmenter(
      makeFrames([
        { kind: 'still', ms: 200 },
        { kind: 'move', ms: 1200 },
        { kind: 'still', ms: 3500 }, // hands rest in the picture, never leave
      ]),
    );
    expect(types(ev)).toEqual(['handsAppeared', 'signStart', 'signEnd', 'pause']);
    expect(types(ev)).not.toContain('handsLeft');
  });

  it('does not emit a pause while a new sign is under way, only after the last one', () => {
    const ev = runSegmenter(
      makeFrames([
        { kind: 'still', ms: 200 },
        { kind: 'move', ms: 1200 },
        { kind: 'still', ms: 900 }, // sign 1 ends; less than the pause has passed
        { kind: 'move', ms: 1200 }, // sign 2 starts before the pause
        { kind: 'still', ms: 3500 },
      ]),
    );
    expect(types(ev).filter((x) => x === 'signEnd')).toHaveLength(2);
    expect(types(ev).filter((x) => x === 'pause')).toHaveLength(1);
    expect(types(ev).at(-1)).toBe('pause'); // and it comes after the second sign
  });

  it('does not emit a pause when no sign was completed', () => {
    const ev = runSegmenter(
      makeFrames([
        { kind: 'still', ms: 500 },
        { kind: 'none', ms: 3000 },
      ]),
    );
    expect(types(ev)).not.toContain('pause');
  });

  it('honours the configurable hold time', () => {
    const frames = makeFrames([
      { kind: 'still', ms: 200 },
      { kind: 'move', ms: 1000 },
      { kind: 'still', ms: 600 },
    ]);
    expect(types(runSegmenter(frames, { ...DEFAULT_SEGMENTER, holdMs: 400 }))).toContain('signEnd');
    expect(types(runSegmenter(frames, { ...DEFAULT_SEGMENTER, holdMs: 1200 }))).not.toContain(
      'signEnd',
    );
  });
});
