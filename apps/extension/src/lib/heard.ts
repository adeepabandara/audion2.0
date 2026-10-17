/**
 * Compare what the voice was asked to say with what Speech-to-Text heard, word by word, ignoring case and
 * punctuation. Used by the voice check to say, in a few words, whether the voice is clear.
 */
export interface HeardResult {
  /** How many of the spoken words were heard. */
  matched: number;
  total: number;
  /** Spoken words that were not heard. */
  missed: string[];
  level: 'clear' | 'mostly' | 'unclear';
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

export function compareHeard(expected: string, heard: string): HeardResult {
  const want = words(expected);
  const got = [...words(heard)];
  const missed: string[] = [];
  let matched = 0;
  for (const w of want) {
    const i = got.indexOf(w);
    if (i === -1) missed.push(w);
    else {
      matched++;
      got.splice(i, 1);
    }
  }
  const share = want.length === 0 ? 0 : matched / want.length;
  return {
    matched,
    total: want.length,
    missed,
    level: share >= 0.95 ? 'clear' : share >= 0.7 ? 'mostly' : 'unclear',
  };
}
