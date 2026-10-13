import { SIGNS } from '@audion/shared';
import type { Recognizer } from '../types.js';

/** Scripted recogniser: cycles through the vocabulary; a configurable share of answers is low confidence. */
export class MockRecognizer implements Recognizer {
  private n = 0;

  constructor(private readonly lowConfidenceRate: number) {}

  async recognize() {
    const i = this.n++;
    const at = (k: number) => SIGNS[(i + k) % SIGNS.length]!;
    // Deterministic pseudo-random spread so tests and demos are repeatable.
    const low = ((i * 37) % 100) / 100 < this.lowConfidenceRate;
    const top = low ? 0.35 : 0.92;
    return {
      sign: at(0),
      confidence: top,
      alternatives: [
        { sign: at(5), confidence: low ? 0.3 : 0.05 },
        { sign: at(11), confidence: low ? 0.2 : 0.02 },
      ],
    };
  }
}
