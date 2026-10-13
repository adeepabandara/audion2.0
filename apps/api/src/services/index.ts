import { GoogleGenAI } from '@google/genai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { checkLiveConfig, type Config } from '../config.js';
import { GeminiComposer } from './live/composer.js';
import { GeminiRecognizer } from './live/recognizer.js';
import { CloudSpeaker, type TtsClient } from './live/speaker.js';
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

  const { errors } = checkLiveConfig(config);
  if (errors.length) throw new Error(errors.join(' '));
  // Application Default Credentials: on Cloud Run this is the service account, locally `gcloud auth
  // application-default login`. No keys are read from the repo or environment.
  const clients = new Map<string, GoogleGenAI>();
  const clientFor = (location: string) => {
    let c = clients.get(location);
    if (!c)
      clients.set(
        location,
        (c = new GoogleGenAI({ vertexai: true, project: config.gcpProject, location })),
      );
    return c;
  };
  return {
    mode: 'live',
    // A tuned model is addressed by its endpoint resource name in its own region, e.g.
    // RECOGNIZE_MODEL=projects/<number>/locations/us-central1/endpoints/<id>  RECOGNIZE_LOCATION=us-central1
    recognizer: new GeminiRecognizer(clientFor(config.recognize.location), config.recognize.model),
    composer: new GeminiComposer(clientFor(config.compose.location), config.compose.model),
    speaker: new CloudSpeaker(new TextToSpeechClient() as unknown as TtsClient),
  };
}
