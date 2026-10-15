import type { ThinkingLevel } from '@google/genai';
import {
  getLanguage,
  MAX_SPEAK_CHARS,
  TRANSLATE_SYSTEM_PROMPT,
  type TranslateRequest,
} from '@audion/shared';
import { AppError } from '../../errors.js';
import type { Translator } from '../types.js';
import type { GenAIClient } from './client.js';
import { answerText, mapVertexError } from './recognizer.js';
import { TIMEOUTS, withTimeout } from './timeout.js';

/**
 * Live translation with a Gemini text model. The sentence is the signer's own words: it goes to the model in memory,
 * is never written or logged, and the model is told to translate it and nothing else. The answer is cleaned and
 * length-capped, which also limits what a hostile sentence could push downstream.
 */
export class GeminiTranslator implements Translator {
  constructor(
    private readonly client: GenAIClient,
    private readonly model: string,
    private readonly timeoutMs: number = TIMEOUTS.composeMs,
    private readonly thinkingLevel?: string,
  ) {}

  async translate({ text, language }: TranslateRequest): Promise<string> {
    const target = getLanguage(language);
    if (!target) throw new AppError('BAD_REQUEST', 'Unknown language.');
    let res;
    try {
      res = await withTimeout(this.timeoutMs, (abortSignal) =>
        this.client.models.generateContent({
          model: this.model,
          contents: [
            {
              role: 'user',
              parts: [{ text: `Target language: ${target.english}\nSentence: ${text}` }],
            },
          ],
          config: {
            systemInstruction: TRANSLATE_SYSTEM_PROMPT,
            temperature: 0.1,
            maxOutputTokens: 1024,
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
    const out = cleanTranslation(answerText(res));
    if (!out) throw new AppError('MODEL_UNAVAILABLE', 'The model returned no translation.');
    return out;
  }
}

/** One line of plain text: no quotes, markdown or "Translation:" label, never longer than a spoken sentence. */
export function cleanTranslation(raw: string): string {
  const text = raw
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/[*_`]+/g, '')
    .replace(/^\s*(translation|translated)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”«»]+|["“”«»]+$/g, '')
    .trim();
  return text.length > MAX_SPEAK_CHARS ? text.slice(0, MAX_SPEAK_CHARS).trimEnd() : text;
}
