import { MAX_CONTEXT_CHARS, type ContextRequest } from '@audion/shared';
import type { Summarizer } from '../types.js';

/** MOCK=1: no model. The "summary" is just the most recent caption text, trimmed, so the feature can be tried offline. */
export class MockSummarizer implements Summarizer {
  async summarize({ transcript, previous }: ContextRequest): Promise<string> {
    const words = `${previous ?? ''} ${transcript}`.split(/\s+/).filter(Boolean);
    return `Meeting so far: ${words.slice(-60).join(' ')}`.slice(0, MAX_CONTEXT_CHARS);
  }
}
