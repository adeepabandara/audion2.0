import type { ThinkingLevel } from '@google/genai';
import { COMPOSE_CONTEXT_NOTE, COMPOSE_SYSTEM_PROMPT, type ComposeRequest } from '@audion/shared';
import { AppError } from '../../errors.js';
import type { Composer } from '../types.js';
import type { GenAIClient } from './client.js';
import { answerText, mapVertexError } from './recognizer.js';
import { TIMEOUTS, withTimeout } from './timeout.js';

const SHOTS: Array<[string[], string]> = [
  [['hello', 'please', 'wait'], 'Hello, please wait.'],
  [['tomorrow', 'talk', 'finish'], "We'll finish talking tomorrow."],
  [['thankyou', 'bye'], 'Thank you, goodbye.'],
  [['where', 'time'], 'Where is the time?'],
];

const glossLine = (signs: string[], tone?: string, context?: string) =>
  `${context ? `Meeting context: ${context}\n` : ''}Glosses: ${signs.join(', ')}${
    tone === 'polite' ? '\nTone: polite' : ''
  }`;

/** Turns glosses into one sentence with a Gemini text model. The route's grounding guard checks the result. */
export class GeminiComposer implements Composer {
  constructor(
    private readonly client: GenAIClient,
    private readonly model: string,
    private readonly timeoutMs: number = TIMEOUTS.composeMs,
    /** Less thinking is faster. Unset = the model's default (about 2 s for one short sentence). */
    private readonly thinkingLevel?: string,
  ) {}

  async warmUp(): Promise<void> {
    await this.compose({ signs: ['hello', 'please'] }).catch(() => {});
  }

  async compose({ signs, tone, context }: ComposeRequest): Promise<string> {
    let res;
    try {
      res = await withTimeout(this.timeoutMs, (abortSignal) =>
        this.client.models.generateContent({
          model: this.model,
          contents: [
            ...SHOTS.flatMap(([g, s]) => [
              { role: 'user', parts: [{ text: glossLine(g) }] },
              { role: 'model', parts: [{ text: s }] },
            ]),
            { role: 'user', parts: [{ text: glossLine(signs, tone, context) }] },
          ],
          config: {
            systemInstruction: context
              ? `${COMPOSE_SYSTEM_PROMPT} ${COMPOSE_CONTEXT_NOTE}`
              : COMPOSE_SYSTEM_PROMPT,
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
    const sentence = cleanSentence(answerText(res));
    if (!sentence) throw new AppError('MODEL_UNAVAILABLE', 'The model returned no sentence.');
    return sentence;
  }
}

/** First non-empty line, without wrapping quotes or code fences. */
export function cleanSentence(raw: string): string {
  const line =
    raw
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('```')) ?? '';
  return line.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim();
}
