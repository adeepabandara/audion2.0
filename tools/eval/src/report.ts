import { SIGNS } from '@audion/shared';
import type { EvalResult } from './run.js';

export const BASELINE_ACCURACY = 0.262; // untuned Gemini 3.5 Flash

export interface SignStat {
  sign: string;
  n: number;
  correct: number;
  accuracy: number;
}

export interface Report {
  total: number;
  answered: number;
  errors: Array<{ code: string; count: number }>;
  correct: number;
  accuracy: number;
  unknownRate: number;
  perSign: SignStat[];
  confusions: Array<{ truth: string; predicted: string; count: number }>;
  latency: { apiP50: number; apiP95: number; wallP50: number; wallP95: number };
  confidence: {
    reported: number;
    missing: number;
    meanWhenCorrect: number | null;
    meanWhenWrong: number | null;
    buckets: Array<{ range: string; n: number; accuracy: number | null }>;
  };
  /** For picking CONFIDENCE_THRESHOLD: if signs below `threshold` need confirming, how many do, and how right are the rest? */
  thresholdSweep: Array<{ threshold: number; needConfirm: number; accuracyOfRest: number | null }>;
  suggestion: ThresholdSuggestion;
  vsBaseline: number;
}

export interface ThresholdSuggestion {
  /** Lowest threshold meeting both goals, or null if none does. */
  threshold: number | null;
  needConfirm: number | null;
  accuracyOfRest: number | null;
  goal: { minAccuracyOfRest: number; maxConfirmRate: number };
}

/**
 * Pick CONFIDENCE_THRESHOLD: the lowest value at which the signs that are NOT asked about are at least
 * `minAccuracyOfRest` right, while asking about no more than `maxConfirmRate` of all signs. (A lower threshold
 * asks less often; a higher one catches more mistakes but interrupts the signer more.)
 */
export function suggestThreshold(
  confidences: Array<{ confidence: number; correct: boolean }>,
  goal = { minAccuracyOfRest: 0.9, maxConfirmRate: 0.4 },
): ThresholdSuggestion {
  const none: ThresholdSuggestion = {
    threshold: null,
    needConfirm: null,
    accuracyOfRest: null,
    goal,
  };
  if (!confidences.length) return none;
  for (let t = 0.05; t <= 0.951; t += 0.05) {
    const threshold = Math.round(t * 100) / 100;
    const rest = confidences.filter((c) => c.confidence >= threshold);
    if (!rest.length) continue;
    const accuracyOfRest = rest.filter((c) => c.correct).length / rest.length;
    const needConfirm = (confidences.length - rest.length) / confidences.length;
    if (accuracyOfRest >= goal.minAccuracyOfRest && needConfirm <= goal.maxConfirmRate) {
      return { threshold, needConfirm, accuracyOfRest, goal };
    }
  }
  return none;
}

const pct = (n: number, d: number) => (d === 0 ? 0 : n / d);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export function buildReport(results: EvalResult[]): Report {
  const answered = results.flatMap((r) =>
    r.outcome.ok ? [{ truth: r.item.label as string, ...r.outcome }] : [],
  );
  const errorCounts = new Map<string, number>();
  for (const r of results)
    if (!r.outcome.ok) errorCounts.set(r.outcome.code, (errorCounts.get(r.outcome.code) ?? 0) + 1);

  const isRight = (a: (typeof answered)[number]) => a.result.sign === a.truth;
  const correct = answered.filter(isRight).length;

  const perSign = SIGNS.map((sign) => {
    const mine = answered.filter((a) => a.truth === sign);
    const right = mine.filter(isRight).length;
    return {
      sign: sign as string,
      n: mine.length,
      correct: right,
      accuracy: pct(right, mine.length),
    };
  }).filter((s) => s.n > 0);

  const conf = new Map<string, number>();
  for (const a of answered.filter((x) => !isRight(x))) {
    const k = `${a.truth}\u0000${a.result.sign}`;
    conf.set(k, (conf.get(k) ?? 0) + 1);
  }
  const confusions = [...conf]
    .map(([k, count]) => {
      const [truth, predicted] = k.split('\u0000') as [string, string];
      return { truth, predicted, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const api = answered.map((a) => a.result.latencyMs).sort((a, b) => a - b);
  const wall = answered.map((a) => a.wallMs).sort((a, b) => a - b);

  const withConf = answered.filter((a) => a.result.confidence !== null);
  const c = (a: (typeof answered)[number]) => a.result.confidence as number;
  const bucketEdges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const buckets = bucketEdges.slice(0, -1).map((lo, i) => {
    const hi = bucketEdges[i + 1]!;
    const inB = withConf.filter((a) => c(a) >= lo && c(a) < hi);
    return {
      range: `${lo.toFixed(1)}-${Math.min(1, hi).toFixed(1)}`,
      n: inB.length,
      accuracy: inB.length ? pct(inB.filter(isRight).length, inB.length) : null,
    };
  });

  const thresholdSweep = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((threshold) => {
    const rest = withConf.filter((a) => c(a) >= threshold);
    return {
      threshold,
      needConfirm: pct(withConf.length - rest.length, withConf.length),
      accuracyOfRest: rest.length ? pct(rest.filter(isRight).length, rest.length) : null,
    };
  });

  const suggestion = suggestThreshold(
    withConf.map((a) => ({ confidence: c(a), correct: isRight(a) })),
  );
  const accuracy = pct(correct, answered.length);
  return {
    total: results.length,
    answered: answered.length,
    errors: [...errorCounts].map(([code, count]) => ({ code, count })),
    correct,
    accuracy,
    unknownRate: pct(answered.filter((a) => a.result.sign === 'unknown').length, answered.length),
    perSign,
    confusions,
    latency: {
      apiP50: percentile(api, 50),
      apiP95: percentile(api, 95),
      wallP50: percentile(wall, 50),
      wallP95: percentile(wall, 95),
    },
    confidence: {
      reported: withConf.length,
      missing: answered.length - withConf.length,
      meanWhenCorrect: mean(withConf.filter(isRight).map(c)),
      meanWhenWrong: mean(withConf.filter((a) => !isRight(a)).map(c)),
      buckets,
    },
    thresholdSweep,
    suggestion,
    vsBaseline: accuracy - BASELINE_ACCURACY,
  };
}

const p1 = (n: number) => `${(n * 100).toFixed(1)}%`;

export function formatReport(r: Report): string {
  const L: string[] = [];
  L.push(`Clips: ${r.total}   answered: ${r.answered}   errors: ${r.total - r.answered}`);
  if (r.errors.length)
    L.push(`  error codes: ${r.errors.map((e) => `${e.code}x${e.count}`).join(', ')}`);
  L.push('');
  L.push(
    `Accuracy: ${p1(r.accuracy)} (${r.correct}/${r.answered})   baseline ${p1(BASELINE_ACCURACY)}   ${r.vsBaseline >= 0 ? 'above' : 'BELOW'} baseline by ${(Math.abs(r.vsBaseline) * 100).toFixed(1)} points`,
  );
  L.push(`Answered "unknown": ${p1(r.unknownRate)}`);
  L.push('');
  L.push('Per sign (worst first):');
  for (const s of [...r.perSign].sort((a, b) => a.accuracy - b.accuracy)) {
    L.push(`  ${s.sign.padEnd(9)} ${p1(s.accuracy).padStart(6)}  ${s.correct}/${s.n}`);
  }
  L.push('');
  L.push('Top confusions (truth -> predicted):');
  if (!r.confusions.length) L.push('  none');
  for (const c of r.confusions)
    L.push(`  ${c.truth.padEnd(9)} -> ${c.predicted.padEnd(9)} x${c.count}`);
  L.push('');
  L.push(
    `Latency  API p50 ${r.latency.apiP50.toFixed(0)} ms, p95 ${r.latency.apiP95.toFixed(0)} ms   round trip p50 ${r.latency.wallP50.toFixed(0)} ms, p95 ${r.latency.wallP95.toFixed(0)} ms`,
  );
  L.push('');
  if (r.confidence.reported === 0) {
    L.push(
      `Confidence: the API reported none (${r.confidence.missing} answers). Every answer will count as confirmed in the extension.`,
    );
  } else {
    L.push(
      `Confidence reported on ${r.confidence.reported}/${r.answered}. Mean when right ${r.confidence.meanWhenCorrect?.toFixed(2) ?? '-'}, when wrong ${r.confidence.meanWhenWrong?.toFixed(2) ?? '-'}`,
    );
    L.push('  bucket     n   accuracy');
    for (const b of r.confidence.buckets)
      L.push(
        `  ${b.range.padEnd(8)} ${String(b.n).padStart(4)}   ${b.accuracy === null ? '-' : p1(b.accuracy)}`,
      );
    L.push('');
    L.push('Threshold sweep (signs below the threshold ask "Did you mean...?"):');
    L.push('  threshold  asks to confirm  accuracy of the rest');
    const g = r.suggestion.goal;
    L.push(
      r.suggestion.threshold === null
        ? `  No threshold gets the unasked signs to ${p1(g.minAccuracyOfRest)} accuracy while asking about at most ${p1(g.maxConfirmRate)}. Keep 0.5 and improve the model first.`
        : `  Suggested CONFIDENCE_THRESHOLD=${r.suggestion.threshold.toFixed(2)}: asks about ${p1(r.suggestion.needConfirm!)} of signs, the rest are ${p1(r.suggestion.accuracyOfRest!)} right (goal: >= ${p1(g.minAccuracyOfRest)} right, <= ${p1(g.maxConfirmRate)} asked).`,
    );
    for (const t of r.thresholdSweep)
      L.push(
        `  ${t.threshold.toFixed(1).padStart(9)}  ${p1(t.needConfirm).padStart(14)}  ${t.accuracyOfRest === null ? '-' : p1(t.accuracyOfRest)}`,
      );
  }
  return L.join('\n');
}
