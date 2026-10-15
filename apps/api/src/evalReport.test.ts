import { describe, expect, it } from 'vitest';
import { formatSummary, summarize, toCsv, type EvalRow } from './evalReport.js';

const row = (truth: string, predicted: string, extra: Partial<EvalRow> = {}): EvalRow => ({
  file: `${truth}/a.mp4`,
  truth,
  predicted,
  confidence: 0.8,
  latencyMs: 1200,
  ...extra,
});

describe('summarize', () => {
  const rows = [
    row('hello', 'hello'),
    row('hello', 'bye'),
    row('hello', 'bye'),
    row('yes', 'yes'),
    row('yes', 'unknown'),
    row('wait', 'wait', { error: 'MODEL_UNAVAILABLE', predicted: 'unknown' }),
  ];
  const s = summarize(rows);

  it('computes overall and per-sign accuracy, counting failed calls as wrong', () => {
    expect(s.total).toBe(6);
    expect(s.correct).toBe(2);
    expect(s.accuracy).toBeCloseTo(2 / 6);
    expect(s.errors).toBe(1);
    expect(s.perSign.find((p) => p.sign === 'hello')).toMatchObject({ total: 3, correct: 1 });
    expect(s.perSign.find((p) => p.sign === 'wait')).toMatchObject({ total: 1, correct: 0 });
  });

  it('lists the most common confusions first, with errors as their own kind', () => {
    expect(s.confusions[0]).toEqual({ truth: 'hello', predicted: 'bye', count: 2 });
    expect(s.confusions.map((c) => `${c.truth}>${c.predicted}`)).toContain('wait>error');
    expect(summarize(rows, 1).confusions).toHaveLength(1);
  });

  it('handles an empty run', () => {
    expect(summarize([])).toMatchObject({ total: 0, accuracy: 0, perSign: [], confusions: [] });
  });

  it('prints the baseline next to the result', () => {
    const text = formatSummary(s, 0.262);
    expect(text).toMatch(/Overall: 2\/6 correct = 33\.3%\s+\(untuned baseline 26\.2%\)/);
    expect(text).toMatch(/hello -> bye {2}x2/);
  });
});

describe('toCsv', () => {
  it('writes one line per clip with correctness, quoting where needed', () => {
    const csv = toCsv([
      row('hello', 'hello'),
      row('no', 'yes', { file: 'no/a,b.mp4', confidence: null }),
    ]);
    const [head, a, b] = csv.trim().split('\n');
    expect(head).toBe('file,truth,predicted,correct,confidence,latency_ms,error');
    expect(a).toBe('hello/a.mp4,hello,hello,1,0.8000,1200,');
    expect(b).toBe('"no/a,b.mp4",no,yes,0,,1200,');
  });
});
