import { describe, expect, it } from 'vitest';
import { compareHeard } from './heard';

describe('compareHeard', () => {
  it('ignores case and punctuation: every word heard is clear', () => {
    const r = compareHeard('Hello, I’m signing with Ola.', 'hello i’m signing with ola');
    expect(r).toMatchObject({ matched: 5, total: 5, missed: [], level: 'clear' });
  });

  it('names the words that were missed and grades the result', () => {
    const r = compareHeard('Please wait a moment', 'please wait moment');
    expect(r.missed).toEqual(['a']);
    expect(r.level).toBe('mostly');
    expect(compareHeard('Please wait a moment', 'blue sky').level).toBe('unclear');
  });

  it('counts a repeated word once per time it was heard', () => {
    const r = compareHeard('no no no', 'no no');
    expect(r).toMatchObject({ matched: 2, total: 3, missed: ['no'] });
  });

  it('handles nothing heard', () => {
    expect(compareHeard('Hello there', '')).toMatchObject({ matched: 0, level: 'unclear' });
    expect(compareHeard('', 'anything').level).toBe('unclear');
  });
});

import { peaksOf } from './audioPlayer';

describe('peaksOf', () => {
  it('summarises a sound as slices scaled so the loudest is 1', () => {
    const data = new Float32Array(560);
    data[10] = 0.5;
    data[300] = -0.25;
    const p = peaksOf(data, 56);
    expect(p).toHaveLength(56);
    expect(Math.max(...p)).toBe(1);
    expect(p[1]).toBe(1); // 0.5 is the loudest
    expect(p[30]).toBeCloseTo(0.5);
    expect(p[50]).toBe(0);
  });

  it('copes with silence', () => {
    expect(peaksOf(new Float32Array(100), 10).every((v) => v === 0)).toBe(true);
  });
});
