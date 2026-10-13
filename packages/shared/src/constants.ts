export const MAX_CLIP_BYTES = 2 * 1024 * 1024;
export const MAX_CLIP_SECONDS = 5;
export const MIN_SPEED = 0.75;
export const MAX_SPEED = 1.5;
export const TOKEN_TTL_SEC = 15 * 60;
export const MAX_SPEAK_CHARS = 500;
export const MAX_COMPOSE_SIGNS = 30;

/** The exact prompt used when tuning; the tuned model expects it verbatim. */
export const RECOGNIZE_PROMPT =
  'The video shows one isolated American Sign Language (ASL) sign. Which sign is it? Answer with the English word only.';

export const COMPOSE_SYSTEM_PROMPT =
  'You turn a sequence of ASL sign glosses into one short, natural English sentence. Use every gloss in order of meaning, add only the minimum function words needed, never add new facts, names or content words, and never output anything except the sentence.';

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;
export const DEFAULT_PAUSE_MS = 1500;
