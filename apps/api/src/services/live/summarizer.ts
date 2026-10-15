import type { ThinkingLevel } from '@google/genai';
import { MAX_CONTEXT_CHARS, SUMMARIZE_SYSTEM_PROMPT, type ContextRequest } from '@audion/shared';
import { AppError } from '../../errors.js';
import type { Summarizer } from '../types.js';
import type { GenAIClient } from './client.js';
import { answerText, mapVertexError } from './recognizer.js';
import { TIMEOUTS, withTimeout } from './timeout.js';

/**
 * Keeps a short running summary of a meeting with a Gemini text model. The caption text is other people's words:
 * it goes to the model in memory, is never written or logged, and the model is told to treat it as data, not
 * instructions. The summary is capped in length, which also limits what a hostile caption could push downstream.
 */
export class GeminiSummarizer implements Summarizer {
  constructor(
    private readonly client: GenAIClient,
    private readonly model: string,
    private readonly timeoutMs: number = TIMEOUTS.composeMs * 2,
    private readonly thinkingLevel?: string,
  ) {}

  async summarize({ transcript, previous }: ContextRequest): Promise<string> {
    let res;
    try {
      res = await withTimeout(this.timeoutMs, (abortSignal) =>
        this.client.models.generateContent({
          model: this.model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Previous summary:\n${previous?.trim() || '(none yet)'}\n\nNew captions:\n${transcript}`,
                },
              ],
            },
          ],
          config: {
            systemInstruction: SUMMARIZE_SYSTEM_PROMPT,
            temperature: 0.2,
            maxOutputTokens: 2048,
            candidateCount: 1,
            abortSignal,
            ...(this.thinkingLevel
              ? {
                  thinkingConfig: {
                    thinkingLevel: this.thinkingLevel.toUpperCase() as ThinkingLevel,
                  },
                }
              : {}),
          },
        }),
      );
    } catch (e) {
      throw e instanceof AppError ? e : mapVertexError(e);
    }
    const summary = cleanSummary(answerText(res));
    if (!summary) throw new AppError('MODEL_UNAVAILABLE', 'The model returned no summary.');
    return summary;
  }
}

/** Plain text, one paragraph, no list or markdown marks, and never longer than the context limit. */
export function cleanSummary(raw: string): string {
  const text = raw
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^[\s>*#-]+/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_CONTEXT_CHARS ? text.slice(0, MAX_CONTEXT_CHARS).trimEnd() : text;
}
