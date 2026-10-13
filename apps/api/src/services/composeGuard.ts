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
    'please thanks'
  ).split(' '),
);

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
  now: ['now', 'currently'],
  later: ['later'],
  look: ['look', 'see', 'watch'],
  listen: ['listen', 'hear'],
  talk: ['talk', 'speak'],
  think: ['think', 'thought'],
  why: ['why'],
  who: ['who'],
  where: ['where'],
  wait: ['wait', 'waiting'],
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

export function unexpectedWords(sentence: string, glosses: string[]): string[] {
  const allowed = new Set<string>();
  const stems: string[] = [];
  for (const g of glosses.map((x) => x.toLowerCase())) {
    allowed.add(g);
    stems.push(stem(g));
    for (const f of GLOSS_FORMS[g] ?? []) {
      allowed.add(f);
      stems.push(stem(f));
    }
  }
  return tokenise(sentence).filter((w) => {
    if (FUNCTION_WORDS.has(w) || allowed.has(w)) return false;
    const s = stem(w);
    return !(s.length >= 3 && stems.includes(s));
  });
}

export function isGroundedSentence(sentence: string, glosses: string[]): boolean {
  return unexpectedWords(sentence, glosses).length === 0;
}
