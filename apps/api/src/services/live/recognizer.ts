import { RECOGNIZE_PROMPT } from '@audion/shared';
import { ThinkingLevel } from '@google/genai';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { AppError } from '../../errors.js';
import type { Recognizer, RecognizeInput } from '../types.js';
import { parseAnswer } from './answer.js';
import type { GenAIClient } from './client.js';
import { scoreFromLogprobs } from './logprobs.js';
import { TIMEOUTS, withTimeout } from './timeout.js';

const TOP_LOGPROBS = 5;
/** Gemini 3.x spends output tokens on thinking, so a small limit can leave the answer empty. */
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

/** Text of the answer, excluding any "thought" parts. */
export function answerText(res: GenerateContentResponse): string {
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  return text || (typeof res.text === 'string' ? res.text : '');
}

/** The exact request the recognizer sends. The probe script uses it too, so what you test is what runs. */
export function recognizeRequest(
  model: string,
  clipBase64: string,
  mime: string,
  maxOutputTokens: number,
  withLogprobs: boolean,
  abortSignal?: AbortSignal,
  thinkingLevel?: string,
): GenerateContentParameters {
  return {
    model,
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: mime, data: clipBase64 } }, { text: RECOGNIZE_PROMPT }],
      },
    ],
    config: {
      temperature: 0,
      maxOutputTokens,
      candidateCount: 1,
      ...(abortSignal ? { abortSignal } : {}),
      ...(thinkingLevel
        ? { thinkingConfig: { thinkingLevel: thinkingLevel.toUpperCase() as ThinkingLevel } }
        : {}),
      ...(withLogprobs ? { responseLogprobs: true, logprobs: TOP_LOGPROBS } : {}),
    },
  };
}

export interface GeminiRecognizerOptions {
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** Less thinking is faster: the tuned model took 17 s at its default and 10 s at minimal. */
  thinkingLevel?: string;
  /** What to report as `modelId` (defaults to the model string). Keep endpoint resource paths out of it. */
  modelId?: string;
  /** Called before every paid request (including the retry); throw to refuse it (the daily cap does). */
  beforeCall?: () => void;
}

/**
 * Recognises one isolated sign with Gemini (the base model, or a tuned endpoint: both are just `model`).
 * The prompt is the EXACT training prompt and does not list the vocabulary, because the tuned model learned
 * this wording. The clip goes inline, in memory, and is never written or logged.
 *
 * A failed call is retried once when it could be transient (timeout, 429, 5xx, network). Errors like 400/403/404
 * are not retried: they mean the request or the endpoint ID is wrong.
 */
export class GeminiRecognizer implements Recognizer {
  readonly modelId: string;
  private logprobs = true;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly thinkingLevel?: string;
  private readonly beforeCall?: () => void;

  constructor(
    private readonly client: GenAIClient,
    private readonly model: string,
    options: GeminiRecognizerOptions = {},
  ) {
    this.modelId = options.modelId ?? model;
    this.timeoutMs = options.timeoutMs ?? TIMEOUTS.recognizeMs;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.thinkingLevel = options.thinkingLevel;
    this.beforeCall = options.beforeCall;
  }

  private call(clip: string, mime: string, withLogprobs: boolean) {
    this.beforeCall?.();
    return withTimeout(this.timeoutMs, (abortSignal) =>
      this.client.models.generateContent(
        recognizeRequest(
          this.model,
          clip,
          mime,
          this.maxOutputTokens,
          withLogprobs,
          abortSignal,
          this.thinkingLevel,
        ),
      ),
    );
  }

  private async attempt(data: string, mime: string) {
    let res: GenerateContentResponse;
    try {
      res = await this.call(data, mime, this.logprobs);
    } catch (e) {
      // Some models (possibly tuned ones) reject logprobs. Remember that and answer without confidence,
      // rather than failing every request.
      if (this.logprobs && /logprob|response_logprobs/i.test(String((e as Error).message))) {
        this.logprobs = false;
        res = await this.call(data, mime, false);
      } else {
        throw e;
      }
    }

    const text = answerText(res).trim();
    if (!text) {
      return {
        sign: 'unknown' as const,
        confidence: null,
        alternatives: [],
        modelId: this.modelId,
      };
    }
    const scored = scoreFromLogprobs(res.candidates?.[0]?.logprobsResult, text);
    return {
      sign: parseAnswer(text).sign,
      confidence: scored.confidence,
      alternatives: scored.alternatives,
      modelId: this.modelId,
    };
  }

  /**
   * Make the first real sign fast: the first call after a start pays for the connection and credentials (we measured
   * 4-10 s extra). A prompt-only request with a tiny answer warms those. Never throws; counts as one paid call.
   */
  async warmUp(): Promise<void> {
    try {
      this.beforeCall?.();
      await withTimeout(this.timeoutMs, (abortSignal) => {
        const req = recognizeRequest(
          this.model,
          '',
          'video/mp4',
          16,
          false,
          abortSignal,
          this.thinkingLevel,
        );
        (req.contents as Array<{ parts: unknown[] }>)[0]!.parts.shift(); // drop the video, keep the prompt
        return this.client.models.generateContent(req);
      });
    } catch {
      /* warming is best effort */
    }
  }

  async recognize({ clip, mime }: RecognizeInput) {
    const data = clip.toString('base64');
    let failure: unknown;
    for (let tries = 0; tries < 2; tries++) {
      try {
        return await this.attempt(data, mime);
      } catch (e) {
        if (e instanceof AppError && e.code === 'DAILY_CAP_REACHED') throw e;
        failure = e;
        if (!isTransient(e)) break;
      }
    }
    throw failure instanceof AppError ? failure : mapVertexError(failure);
  }
}

function statusOf(e: unknown): number | undefined {
  if (e instanceof AppError) return e.upstreamStatus;
  const { status, code } = e as { status?: unknown; code?: unknown };
  if (typeof status === 'number') return status;
  return typeof code === 'number' ? code : undefined;
}

/** Worth one more try: a timeout (408), rate limiting (429), a server error (5xx), or no HTTP status at all (network). */
export function isTransient(e: unknown): boolean {
  const s = statusOf(e);
  return s === undefined || s === 408 || s === 429 || s >= 500;
}

/** Vertex errors become our MODEL_UNAVAILABLE (retryable); details stay out of the response. */
export function mapVertexError(e: unknown): AppError {
  const status = statusOf(e);
  return new AppError(
    'MODEL_UNAVAILABLE',
    status === 429
      ? 'The model is busy, try again shortly.'
      : 'The model is temporarily unavailable.',
    status,
  );
}
