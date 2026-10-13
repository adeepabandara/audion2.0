/** The 22-sign vocabulary the tuned model recognises. Order is stable; do not reorder. */
export const SIGNS = [
  'hello',
  'bye',
  'yes',
  'no',
  'please',
  'thankyou',
  'wait',
  'why',
  'who',
  'where',
  'now',
  'later',
  'tomorrow',
  'time',
  'finish',
  'think',
  'look',
  'listen',
  'talk',
  'fine',
  'same',
  'not',
] as const;

export type Sign = (typeof SIGNS)[number];
export type SignOrUnknown = Sign | 'unknown';

const SIGN_SET: ReadonlySet<string> = new Set(SIGNS);

export function isSign(value: string): value is Sign {
  return SIGN_SET.has(value);
}

/** Normalise raw model output: lowercase, strip punctuation/whitespace, map to vocab or 'unknown'. */
export function normaliseSign(raw: string): SignOrUnknown {
  const cleaned = raw.toLowerCase().replace(/[^a-z]/g, '');
  return isSign(cleaned) ? cleaned : 'unknown';
}
