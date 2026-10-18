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
  please_wait: 'please wait',
  thankyou_bye: 'thank you, goodbye',
  yes_please: 'yes, please',
  no_thankyou: 'no, thank you',
  talk_later: 'talk to you later',
  not_now: 'not right now',
  why_not: 'why not',
  think_same: 'I agree',
  fine_thankyou: "I'm fine, thank you",
  talk_tomorrow: "let's talk tomorrow",
  think_not: "I don't think so",
  finish_now: 'all done now',
  tomorrow_time: 'what time tomorrow',
  time_now: 'what time is it now',
  who_where: 'who and where',
  look_listen: 'look and listen',
  wait_later: 'please wait until later',
  hello_fine: "hello, I'm fine",
};

export const PHRASE_SENTENCES: Record<string, string> = {
  please_wait: 'Please wait.',
  thankyou_bye: 'Thank you, goodbye.',
  yes_please: 'Yes, please.',
  no_thankyou: 'No, thank you.',
  talk_later: 'Talk to you later.',
  not_now: 'Not right now.',
  why_not: 'Why not?',
  think_same: 'I agree.',
  fine_thankyou: "I'm fine, thank you.",
  talk_tomorrow: "Let's talk tomorrow.",
  think_not: "I don't think so.",
  finish_now: 'All done now.',
  tomorrow_time: 'What time tomorrow?',
  time_now: 'What time is it now?',
  who_where: 'Who and where?',
  look_listen: 'Look and listen.',
  wait_later: 'Please wait until later.',
  hello_fine: "Hello, I'm fine.",
};

const TIME_WORDS = new Set(['now', 'later', 'tomorrow']);
const QUESTION_WORDS = new Set(['why', 'who', 'where']);
const GREETINGS = new Set(['hello', 'bye', 'yes', 'no']);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Rule-based sentence from glosses. Adds punctuation and a few function words only. Used by MOCK=1 and as the fast path. */
export function composeByRules(signs: string[]): string {
  const g = signs.map((s) => s.toLowerCase());

  // Fast-path: single phrase chip maps immediately to polished sentence
  if (g.length === 1 && PHRASE_SENTENCES[g[0]!]) {
    return PHRASE_SENTENCES[g[0]!]!;
  }

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
