import type { Config } from '../config.js';
import { MockComposer } from './mock/composer.js';
import { MockRecognizer } from './mock/recognizer.js';
import { MockSpeaker } from './mock/speaker.js';
import type { Services } from './types.js';

export function createServices(config: Config): Services {
  if (config.mock) {
    return {
      mode: 'mock',
      recognizer: new MockRecognizer(config.mockLowConfidenceRate),
      composer: new MockComposer(),
      speaker: new MockSpeaker(),
    };
  }
  // Live Vertex AI / Cloud TTS clients arrive in M7.
  throw new Error('Live mode is not implemented yet (M7). Start the API with MOCK=1.');
}
