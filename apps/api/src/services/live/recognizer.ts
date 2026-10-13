import { RECOGNIZE_PROMPT, normaliseSign } from '@audion/shared';
import type { GenerateContentResponse } from '@google/genai';
import { AppError } from '../../errors.js';
import type { Recognizer, RecognizeInput } from '../types.js';
import type { GenAIClient } from './client.js';
import { scoreFromLogprobs } from './logprobs.js';

const TOP_LOGPROBS = 5;
/** Gemini 3.x spends output tokens on thinking, so a small limit can leave the answer empty. */
const MAX_OUTPUT_TOKENS = 2048;

/** Text of the answer, excluding any "thought" parts. */
export function answerText(res: GenerateContentResponse): string {
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  return text || (typeof res.text === 'string' ? res.text : '');
}

/**
 * Recognises one isolated sign with Gemini (the base model, or a tuned endpoint: both are just `model`).
 * The prompt is the EXACT training prompt and does not list the vocabulary, because the tuned model learned
 * this wording. The clip goes inline, in memory, and is never written or logged.
 */
export class GeminiRecognizer implements Recognizer {
  private logprobs = true;

  constructor(
    private readonly client: GenAIClient,
    private readonly model: string,
  ) {}

  private call(clip: string, mime: string, withLogprobs: boolean) {
    return this.client.models.generateContent({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: mime, data: clip } }, { text: RECOGNIZE_PROMPT }],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        candidateCount: 1,
        ...(withLogprobs ? { responseLogprobs: true, logprobs: TOP_LOGPROBS } : {}),
      },
    });
  }

  async recognize({ clip, mime }: RecognizeInput) {
    const data = clip.toString('base64');
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
        throw mapVertexError(e);
      }
    }

    const text = answerText(res).trim();
    if (!text) return { sign: 'unknown' as const, confidence: null, alternatives: [] };
    const scored = scoreFromLogprobs(res.candidates?.[0]?.logprobsResult, text);
    return {
      sign: normaliseSign(text),
      confidence: scored.confidence,
      alternatives: scored.alternatives,
    };
  }
}

/** Vertex errors become our MODEL_UNAVAILABLE (retryable); details stay out of the response. */
export function mapVertexError(e: unknown): AppError {
  const status = (e as { status?: number; code?: number }).status ?? (e as { code?: number }).code;
  return new AppError(
    'MODEL_UNAVAILABLE',
    status === 429
      ? 'The model is busy, try again shortly.'
      : 'The model is temporarily unavailable.',
  );
}
