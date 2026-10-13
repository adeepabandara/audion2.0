import type { GenerateContentResponse } from '@google/genai';
import { SIGNS, normaliseSign, type Sign, type SignOrUnknown } from '@audion/shared';

type Logprobs = NonNullable<
  NonNullable<GenerateContentResponse['candidates']>[number]['logprobsResult']
>;

export interface Scored {
  /** Probability of the whole answer (product of its token probabilities), or null if it cannot be aligned. */
  confidence: number | null;
  alternatives: Array<{ sign: SignOrUnknown; confidence: number }>;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Map a single token to a vocabulary word if it is unambiguous: an exact word, or a prefix (3+ letters) of exactly
 * one word ("thank" -> thankyou). Anything else says nothing about which sign the model considered.
 */
export function tokenToSign(token: string): Sign | null {
  const t = token
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!t) return null;
  const exact = SIGNS.find((s) => s === t);
  if (exact) return exact;
  if (t.length < 3) return null;
  const matches = SIGNS.filter((s) => s.startsWith(t));
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Derive confidence and alternatives from the logprobs of a response whose final text is `answer`.
 *
 * The answer's tokens are found by aligning from the END of the generated tokens (thinking models may emit other
 * tokens first). Confidence is the probability of the full answer, so multi-token words ("thank"+"you") are not
 * overrated. Alternatives come from the top candidates at the answer's first token, mapped to vocabulary words.
 * If the alignment fails, confidence is null: we never invent a number.
 */
export function scoreFromLogprobs(lp: Logprobs | undefined, answer: string): Scored {
  const chosen = lp?.chosenCandidates;
  const none: Scored = { confidence: null, alternatives: [] };
  if (!chosen?.length || !answer.trim()) return none;

  const target = answer.trim();
  let acc = '';
  let start = -1;
  for (let i = chosen.length - 1; i >= 0; i--) {
    acc = (chosen[i]?.token ?? '') + acc;
    if (acc.trim() === target) {
      start = i;
      break;
    }
    if (acc.trim().length > target.length) break; // overshot: tokens do not spell the answer
  }
  if (start < 0) return none;

  let sum = 0;
  let any = false;
  for (const c of chosen.slice(start)) {
    if (!(c.token ?? '').trim()) continue; // pure whitespace/newline tokens carry no sign information
    if (typeof c.logProbability !== 'number') return none;
    sum += c.logProbability;
    any = true;
  }
  if (!any) return none;

  const chosenSign = normaliseSign(answer);
  const seen = new Set<string>([chosenSign]);
  const alternatives: Scored['alternatives'] = [];
  for (const cand of lp?.topCandidates?.[start]?.candidates ?? []) {
    const sign = tokenToSign(cand.token ?? '');
    if (!sign || seen.has(sign) || typeof cand.logProbability !== 'number') continue;
    seen.add(sign);
    alternatives.push({ sign, confidence: clamp01(Math.exp(cand.logProbability)) });
    if (alternatives.length === 3) break;
  }
  return { confidence: clamp01(Math.exp(sum)), alternatives };
}
