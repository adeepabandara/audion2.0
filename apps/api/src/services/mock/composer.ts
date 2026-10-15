import type { ComposeRequest } from '@audion/shared';
import type { Composer } from '../types.js';

const WORDS: Record<string, string> = {
  hello: 'hello',
  bye: 'goodbye',
  yes: 'yes',
  no: 'no',
  please: 'please',
  thankyou: 'thank you',
  wait: 'wait',
  why: 'why',
  who: 'who',
  where: 'where',
  now: 'now',
  later: 'later',
  tomorrow: 'tomorrow',
  time: 'time',
  finish: 'finish',
  think: 'think',
  look: 'look',
  listen: 'listen',
  talk: 'talk',
  fine: 'fine',
  same: 'same',
  not: 'not',
};

const TIME_WORDS = new Set(['now', 'later', 'tomorrow']);
const QUESTION_WORDS = new Set(['why', 'who', 'where']);
const GREETINGS = new Set(['hello', 'bye', 'yes', 'no']);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Rule-based sentence from glosses. Adds punctuation and a few function words only. Used by MOCK=1 and as the fast path. */
export function composeByRules(signs: string[]): string {
  const g = signs.map((s) => s.toLowerCase());

  // Pattern: [time..., talk, finish] reads best as "We'll finish talking <time>."
  if (g.includes('talk') && g.includes('finish')) {
    const time = g.find((x) => TIME_WORDS.has(x));
    return `We'll finish talking${time ? ` ${time}` : ''}.`;
  }

  const parts = [...g];
  // Time words go to the end of a statement, as in English.
  const time = parts.filter((x) => TIME_WORDS.has(x));
  const rest = parts.filter((x) => !TIME_WORDS.has(x));
  const ordered = [...rest, ...time];

  const out: string[] = [];
  ordered.forEach((w, i) => {
    const word = WORDS[w] ?? w;
    const next = ordered[i + 1];
    const isLast = i === ordered.length - 1;
    out.push(GREETINGS.has(w) && !isLast && next !== undefined ? `${word},` : word);
  });

  const text = cap(out.join(' ').replace(/,\s*,/g, ','));
  const isQuestion = g.some((x) => QUESTION_WORDS.has(x));
  return `${text}${isQuestion ? '?' : '.'}`;
}

/** Rule-based composer used by MOCK=1. */
export class MockComposer implements Composer {
  async compose({ signs }: ComposeRequest): Promise<string> {
    return composeByRules(signs);
  }
}
