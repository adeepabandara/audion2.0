import type { Transcriber } from '../types.js';

/**
 * MOCK=1: nothing is recognised. The "heard" text is simply the text that was spoken (passed as a hint), so the
 * screen can be tried offline; the response says `mode: "mock"` so it is never presented as a real check.
 */
export class MockTranscriber implements Transcriber {
  async transcribe({ hint }: { hint?: string }): Promise<string> {
    return hint ?? '';
  }
}
