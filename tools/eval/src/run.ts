import type { Sign } from '@audion/shared';
import type { Outcome } from './client.js';
import type { EvalItem } from './manifest.js';

export interface EvalResult {
  item: EvalItem;
  outcome: Outcome;
}

/** Run `work` over `items` with at most `concurrency` in flight; results keep the input order. */
export async function pool<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T, i: number) => Promise<R>,
  onDone?: (done: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const limit = Math.max(1, Math.floor(concurrency));
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await work(items[i]!, i);
        onDone?.(++done);
      }
    }),
  );
  return results;
}

export async function runEval(
  items: EvalItem[],
  recognize: (item: EvalItem) => Promise<Outcome>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<EvalResult[]> {
  return pool(
    items,
    concurrency,
    async (item) => ({ item, outcome: await recognize(item) }),
    (d) => onProgress?.(d, items.length),
  );
}

export type { Sign };
