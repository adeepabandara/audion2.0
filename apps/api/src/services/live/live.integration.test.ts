import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { createRecognizer } from '../index.js';

/**
 * Opt-in: one real call to the tuned endpoint (costs a little). Skipped unless RUN_LIVE_TESTS=1.
 *   RUN_LIVE_TESTS=1 TUNED_ENDPOINT_ID=<id> LIVE_TEST_CLIP=./hello.mp4 LIVE_TEST_EXPECT=hello pnpm --filter @audion/api test
 * Needs `gcloud auth application-default login`. The clip stays on your machine and is not committed.
 */
describe.skipIf(!process.env.RUN_LIVE_TESTS)('live tuned endpoint', () => {
  it('names the sign in one clip', async () => {
    const clipPath = process.env.LIVE_TEST_CLIP;
    if (!clipPath || !process.env.TUNED_ENDPOINT_ID) {
      throw new Error('Set TUNED_ENDPOINT_ID and LIVE_TEST_CLIP (a short .mp4 of one sign).');
    }
    const config = loadConfig({ ...process.env, RECOGNIZER_MODE: 'tuned' });
    const recognizer = createRecognizer(config);
    const mime = clipPath.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    const out = await recognizer.recognize({ clip: readFileSync(clipPath), mime });
    expect(out.modelId).toBe(`tuned:${process.env.TUNED_ENDPOINT_ID}`);
    if (process.env.LIVE_TEST_EXPECT) expect(out.sign).toBe(process.env.LIVE_TEST_EXPECT);
    else expect(out.sign).not.toBe('unknown');
  }, 60_000);
});
