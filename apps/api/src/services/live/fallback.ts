import { AppError } from '../../errors.js';
import type { Recognizer, RecognizeInput } from '../types.js';

/**
 * Only built when RECOGNIZER_FALLBACK=base. If the primary (tuned) recognizer fails, answer with the secondary
 * (base) one, and say so through `onFallback`. The answer's `modelId` is the secondary's, so a tester can see it
 * happened. The daily cap is never bypassed.
 */
export class FallbackRecognizer implements Recognizer {
  readonly modelId: string;

  constructor(
    private readonly primary: Recognizer,
    private readonly secondary: Recognizer,
    private readonly onFallback: (e: unknown) => void = () => {},
  ) {
    this.modelId = primary.modelId;
  }

  warmUp(): Promise<void> {
    return this.primary.warmUp?.() ?? Promise.resolve();
  }

  async recognize(input: RecognizeInput) {
    try {
      return await this.primary.recognize(input);
    } catch (e) {
      if (e instanceof AppError && e.code === 'DAILY_CAP_REACHED') throw e;
      this.onFallback(e);
      return this.secondary.recognize(input);
    }
  }
}
