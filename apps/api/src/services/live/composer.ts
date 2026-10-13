import { COMPOSE_SYSTEM_PROMPT, type ComposeRequest } from '@audion/shared';
import { AppError } from '../../errors.js';
import type { Composer } from '../types.js';
import type { GenAIClient } from './client.js';
import { answerText, mapVertexError } from './recognizer.js';

const SHOTS: Array<[string[], string]> = [
  [['hello', 'please', 'wait'], 'Hello, please wait.'],
  [['tomorrow', 'talk', 'finish'], "We'll finish talking tomorrow."],
  [['thankyou', 'bye'], 'Thank you, goodbye.'],
  [['where', 'time'], 'Where is the time?'],
];

const glossLine = (signs: string[], tone?: string) =>
  `Glosses: ${signs.join(', ')}${tone === 'polite' ? '\nTone: polite' : ''}`;

/** Turns glosses into one sentence with a Gemini text model. The route's grounding guard checks the result. */
export class GeminiComposer implements Composer {
  constructor(
    private readonly client: GenAIClient,
    private readonly model: string,
  ) {}

  async compose({ signs, tone }: ComposeRequest): Promise<string> {
    let res;
    try {
      res = await this.client.models.generateContent({
        model: this.model,
        contents: [
          ...SHOTS.flatMap(([g, s]) => [
            { role: 'user', parts: [{ text: glossLine(g) }] },
            { role: 'model', parts: [{ text: s }] },
          ]),
          { role: 'user', parts: [{ text: glossLine(signs, tone) }] },
        ],
        config: {
          systemInstruction: COMPOSE_SYSTEM_PROMPT,
          temperature: 0.2,
          maxOutputTokens: 2048,
          candidateCount: 1,
        },
      });
    } catch (e) {
      throw mapVertexError(e);
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
