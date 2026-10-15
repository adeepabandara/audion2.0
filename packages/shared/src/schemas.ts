import { z } from 'zod';
import {
  MAX_COMPOSE_SIGNS,
  MAX_CONTEXT_CHARS,
  MAX_SPEAK_CHARS,
  MAX_SPEED,
  MAX_TRANSCRIPT_CHARS,
  MIN_SPEED,
} from './constants.js';
import { SIGNS } from './signs.js';
import { VOICE_IDS } from './voices.js';

export const signOrUnknownSchema = z.enum([...SIGNS, 'unknown']);
export const signSchema = z.enum(SIGNS);

export const ERROR_CODES = [
  'RATE_LIMITED',
  'CLIP_TOO_LARGE',
  'MODEL_UNAVAILABLE',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  /** The server's daily cap on paid model calls was reached (dev cost guard). Not retryable. */
  'DAILY_CAP_REACHED',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// POST /v1/session
export const sessionRequestSchema = z.object({ installId: z.string().uuid() });
export type SessionRequest = z.infer<typeof sessionRequestSchema>;
export const sessionResponseSchema = z.object({
  token: z.string(),
  expiresInSec: z.number().int().positive(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// POST /v1/recognize (multipart: clip file, field `mime`)
export const recognizeFieldsSchema = z.object({
  mime: z.string().regex(/^video\/[a-z0-9.+-]+$/i),
  /** Clip length reported by the recorder; the API rejects clips over MAX_CLIP_SECONDS. */
  durationMs: z.coerce.number().positive().optional(),
});
export const candidateSchema = z.object({
  sign: signOrUnknownSchema,
  confidence: z.number().min(0).max(1),
});
export const recognizeResponseSchema = z.object({
  sign: signOrUnknownSchema,
  /** null when the model gives no logprobs: never invent a number. */
  confidence: z.number().min(0).max(1).nullable(),
  alternatives: z.array(candidateSchema),
  latencyMs: z.number().nonnegative(),
  /** Which model produced the answer (for testers; shown under About in Settings). */
  modelId: z.string().optional(),
});
export type RecognizeResponse = z.infer<typeof recognizeResponseSchema>;

// POST /v1/compose
export const composeRequestSchema = z.object({
  signs: z.array(z.string().min(1).max(40)).min(1).max(MAX_COMPOSE_SIGNS),
  tone: z.enum(['neutral', 'polite']).optional(),
  /** Short summary of the meeting, for wording only (see /v1/context). Never stored or logged. */
  context: z.string().max(MAX_CONTEXT_CHARS).optional(),
});
export type ComposeRequest = z.infer<typeof composeRequestSchema>;
export const composeResponseSchema = z.object({ sentence: z.string().min(1) });
export type ComposeResponse = z.infer<typeof composeResponseSchema>;

// POST /v1/context: refresh the running meeting summary from new live-caption text. Nothing here is stored or logged.
export const contextRequestSchema = z.object({
  transcript: z.string().min(1).max(MAX_TRANSCRIPT_CHARS),
  previous: z.string().max(MAX_CONTEXT_CHARS).optional(),
});
export type ContextRequest = z.infer<typeof contextRequestSchema>;
export const contextResponseSchema = z.object({ summary: z.string().max(MAX_CONTEXT_CHARS) });
export type ContextResponse = z.infer<typeof contextResponseSchema>;

// POST /v1/speak
export const speakRequestSchema = z.object({
  text: z.string().min(1).max(MAX_SPEAK_CHARS),
  voiceId: z.enum(VOICE_IDS),
  speed: z.number().min(MIN_SPEED).max(MAX_SPEED),
});
export type SpeakRequest = z.infer<typeof speakRequestSchema>;

// POST /v1/feedback: thumbs up/down on a transcript. Only the rating and sign labels, never video or text.
export const feedbackRequestSchema = z.object({
  rating: z.enum(['up', 'down']),
  signs: z.array(signSchema).max(200),
});
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

// GET /healthz
export const healthResponseSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(['live', 'mock']),
  /** Below this, the extension asks the signer to confirm a recognised sign. */
  confidenceThreshold: z.number().min(0).max(1).optional(),
  /** The recognizer the server is configured with, e.g. "mock", "gemini-3.5-flash" or "tuned:<endpoint id>". */
  modelId: z.string().optional(),
  /** Which voices speak: Google Cloud Text-to-Speech or the mock placeholder tone. */
  voices: z.enum(['google', 'mock']).optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
