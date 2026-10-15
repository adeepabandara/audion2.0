import { SIGNS } from '@audion/shared';

export interface EvalRow {
  file: string;
  /** The true sign (from the folder name). */
  truth: string;
  /** What the recognizer answered ("unknown" if it could not name one of the 22). */
  predicted: string;
  confidence: number | null;
  latencyMs: number;
  /** Set when the call failed; such rows count as wrong and are reported separately. */
  error?: string;
}

export interface EvalSummary {
  total: number;
  correct: number;
  accuracy: number;
  errors: number;
  perSign: Array<{ sign: string; total: number; correct: number; accuracy: number }>;
  confusions: Array<{ truth: string; predicted: string; count: number }>;
}

const rate = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function summarize(rows: EvalRow[], topConfusions = 10): EvalSummary {
  const per = new Map<string, { total: number; correct: number }>();
  const pairs = new Map<string, number>();
  let correct = 0;
  for (const r of rows) {
    const p = per.get(r.truth) ?? { total: 0, correct: 0 };
    p.total++;
    if (!r.error && r.predicted === r.truth) {
      p.correct++;
      correct++;
    } else {
      const key = `${r.truth}\t${r.error ? 'error' : r.predicted}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
    per.set(r.truth, p);
  }
  const order = (s: string) => {
    const i = (SIGNS as readonly string[]).indexOf(s);
    return i < 0 ? SIGNS.length : i;
  };
  return {
    total: rows.length,
    correct,
    accuracy: rate(correct, rows.length),
    errors: rows.filter((r) => r.error).length,
    perSign: [...per.entries()]
      .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
      .map(([sign, v]) => ({ sign, ...v, accuracy: rate(v.correct, v.total) })),
    confusions: [...pairs.entries()]
      .map(([k, count]) => {
        const [truth, predicted] = k.split('\t') as [string, string];
        return { truth, predicted, count };
      })
      .sort((a, b) => b.count - a.count || a.truth.localeCompare(b.truth))
      .slice(0, topConfusions),
  };
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: EvalRow[]): string {
  const head = 'file,truth,predicted,correct,confidence,latency_ms,error';
  const lines = rows.map((r) =>
    [
      r.file,
      r.truth,
      r.predicted,
      !r.error && r.predicted === r.truth ? 1 : 0,
      r.confidence === null ? '' : r.confidence.toFixed(4),
      Math.round(r.latencyMs),
      r.error ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [head, ...lines].join('\n') + '\n';
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function formatSummary(s: EvalSummary, baseline?: number): string {
  const out = [
    `Overall: ${s.correct}/${s.total} correct = ${pct(s.accuracy)}` +
      (baseline === undefined ? '' : `  (untuned baseline ${pct(baseline)})`),
  ];
  if (s.errors) out.push(`Failed calls: ${s.errors} (counted as wrong)`);
  out.push('', 'Per sign:');
  for (const p of s.perSign) {
    out.push(
      `  ${p.sign.padEnd(9)} ${String(p.correct).padStart(3)}/${String(p.total).padEnd(3)} ${pct(p.accuracy)}`,
    );
  }
  out.push('', 'Top confusions (truth -> predicted):');
  if (s.confusions.length === 0) out.push('  none');
  for (const c of s.confusions) out.push(`  ${c.truth} -> ${c.predicted}  x${c.count}`);
  return out.join('\n');
}
