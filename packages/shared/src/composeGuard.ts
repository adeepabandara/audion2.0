/**
 * Output guard for /v1/compose: every word of the sentence must be a grammar word or derive from
 * one of the input glosses. Catches hallucinated content words.
 */

const FUNCTION_WORDS = new Set(
  (
    'a an the and or but so to of in on at for with from by as if is are am was were be been ' +
    'i me my we us our you your he she it they them this that these those there here ' +
    "i'm i'll i'd i've we'll we're we've we'd you'll you're you've it's that's let's don't " +
    "doesn't didn't can't won't isn't aren't what's who's where's " +
    'do does did will would can could should shall may might must have has had ' +
    'not no yes ok okay ' +
    'please thanks right'
  ).split(' '),
);

/**
 * Question words that turn a few glosses into a question (WHERE TIME -> "What time is the demo?"). Only allowed when
 * there is a meeting context to say what is being asked about; without one they would just be added meaning.
 */
const CONTEXT_QUESTION_WORDS = ['what', 'which', 'how'];

/** Words a gloss may legitimately surface as (besides its own stem). */
const GLOSS_FORMS: Record<string, string[]> = {
  thankyou: ['thank', 'thanks', 'you'],
  bye: ['goodbye', 'bye'],
  hello: ['hello', 'hi'],
  finish: ['finish', 'finished', 'done'],
  fine: ['fine', 'good', 'well'],
  same: ['same'],
  not: ['not', "don't", "doesn't", "didn't", "can't", "won't", "isn't", "aren't"],
  time: ['time', 'when'],
  now: ['now', 'currently', 'right'],
  later: ['later'],
  look: ['look', 'see', 'watch'],
  listen: ['listen', 'hear'],
  talk: ['talk', 'speak'],
  think: ['think', 'thought'],
  why: ['why'],
  who: ['who'],
  where: ['where'],
  wait: ['wait', 'waiting'],
  please_wait: ['please', 'wait', 'waiting'],
  thankyou_bye: ['thank', 'thanks', 'you', 'goodbye', 'bye'],
  yes_please: ['yes', 'please'],
  no_thankyou: ['no', 'thank', 'thanks', 'you'],
  talk_later: ['talk', 'speak', 'later'],
  not_now: ['not', 'now', 'right'],
  why_not: ['why', 'not'],
  think_same: ['think', 'thought', 'agree', 'same'],
  fine_thankyou: ['fine', 'good', 'well', 'thank', 'thanks', 'you'],
  talk_tomorrow: ["let's", 'talk', 'speak', 'tomorrow'],
  think_not: ['think', 'thought', 'not', "don't"],
  finish_now: ['finish', 'finished', 'done', 'now', 'all'],
  tomorrow_time: ['tomorrow', 'time', 'when', 'what'],
  time_now: ['time', 'when', 'now', 'what', 'it'],
  who_where: ['who', 'where'],
  look_listen: ['look', 'see', 'watch', 'listen', 'hear'],
  wait_later: ['wait', 'waiting', 'please', 'later', 'until'],
  hello_fine: ['hello', 'hi', 'fine', 'good', 'well'],
};

function stem(word: string): string {
  return word.replace(/(ing|ed|es|s|e)$/, '');
}

export function tokenise(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[“”"]/g, '')
    .split(/[^a-z']+/)
    .filter(Boolean);
}

/**
 * Words in `sentence` that neither are grammar words nor come from a gloss. Words that appear in the meeting
 * `context` summary are allowed as well (they are how the sentence gets worded for the conversation); anything else
 * the model made up is still caught.
 */
export function unexpectedWords(sentence: string, glosses: string[], context?: string): string[] {
  const allowed = new Set<string>();
  const stems: string[] = [];
  for (const g of glosses.map((x) => x.toLowerCase())) {
    const parts = g.includes('_') ? [g, ...g.split('_')] : [g];
    for (const part of parts) {
      allowed.add(part);
      stems.push(stem(part));
      for (const f of GLOSS_FORMS[part] ?? []) {
        allowed.add(f);
        stems.push(stem(f));
      }
    }
  }
  if (context) for (const q of CONTEXT_QUESTION_WORDS) allowed.add(q);
  for (const w of tokenise(context ?? '')) {
    if (w.length < 3) continue;
    allowed.add(w);
    stems.push(stem(w));
  }
  return tokenise(sentence).filter((w) => {
    if (FUNCTION_WORDS.has(w) || allowed.has(w)) return false;
    const s = stem(w);
    return !(s.length >= 3 && stems.includes(s));
  });
}

export function isGroundedSentence(sentence: string, glosses: string[], context?: string): boolean {
  return unexpectedWords(sentence, glosses, context).length === 0;
}
