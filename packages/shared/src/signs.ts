/** The sign and phrase vocabulary the tuned model recognises. Order is stable; do not reorder. */
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
  'please_wait',
  'thankyou_bye',
  'yes_please',
  'no_thankyou',
  'talk_later',
  'not_now',
  'why_not',
  'think_same',
  'fine_thankyou',
  'talk_tomorrow',
  'think_not',
  'finish_now',
  'tomorrow_time',
  'time_now',
  'who_where',
  'look_listen',
  'wait_later',
  'hello_fine',
] as const;

export type Sign = (typeof SIGNS)[number];
export type SignOrUnknown = Sign | 'unknown';

const SIGN_SET: ReadonlySet<string> = new Set(SIGNS);

export function isSign(value: string): value is Sign {
  return SIGN_SET.has(value);
}

/** Normalise raw model output: lowercase, strip punctuation/whitespace, map to vocab or 'unknown'. */
export function normaliseSign(raw: string): SignOrUnknown {
  const cleaned = raw.toLowerCase().replace(/[^a-z_]/g, '');
  return isSign(cleaned) ? cleaned : 'unknown';
}
