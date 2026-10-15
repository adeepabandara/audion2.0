import { isSign, type SignOrUnknown } from '@audion/shared';

export type AnswerReason = 'empty' | 'out_of_vocabulary';

export interface ParsedAnswer {
  sign: SignOrUnknown;
  /** Why the answer is "unknown" (logged by the server; not part of the API response). */
  reason?: AnswerReason;
}

/**
 * Read the model's answer: lower-case, drop punctuation and whitespace, and match the 22-sign vocabulary.
 * The tuned model should answer with one word, but a base model may add words ("The sign is hello."), so
 * if the whole answer is not a sign we try its last two words joined ("thank you") and then its last word.
 */
export function parseAnswer(raw: string): ParsedAnswer {
  const words = raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z]/g, ''))
    .filter(Boolean);
  if (words.length === 0) return { sign: 'unknown', reason: 'empty' };

  const candidates = [words.join(''), words.slice(-2).join(''), words[words.length - 1]!];
  for (const c of candidates) if (isSign(c)) return { sign: c };
  return { sign: 'unknown', reason: 'out_of_vocabulary' };
}
