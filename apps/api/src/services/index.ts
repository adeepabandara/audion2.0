import { GoogleGenAI } from '@google/genai';
import type { GenAIClient } from './live/client.js';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { checkLiveConfig, type Config } from '../config.js';
import { DailyCallCap, type CountStore } from './callCap.js';
import { GeminiComposer } from './live/composer.js';
import { FallbackRecognizer } from './live/fallback.js';
import { GeminiRecognizer } from './live/recognizer.js';
import { CloudSpeaker, type TtsClient } from './live/speaker.js';
import { GeminiSummarizer } from './live/summarizer.js';
import { MockComposer } from './mock/composer.js';
import { MockSummarizer } from './mock/summarizer.js';
import { MockRecognizer } from './mock/recognizer.js';
import { MockSpeaker } from './mock/speaker.js';
import type { Recognizer, Services } from './types.js';

/** Application Default Credentials: on Cloud Run this is the service account, locally `gcloud auth
 * application-default login`. No keys are read from the repo or environment. */
function makeClientFactory(project: string) {
  const clients = new Map<string, GoogleGenAI>();
  return (location: string) => {
    let c = clients.get(location);
    if (!c) clients.set(location, (c = new GoogleGenAI({ vertexai: true, project, location })));
    return c;
  };
}

/**
 * Pick the recognizer from RECOGNIZER_MODE.
 *  - mock:  scripted answers, nothing leaves the machine.
 *  - base:  untuned Gemini on the global endpoint.
 *  - tuned: the tuned model's endpoint, `projects/<project>/locations/<TUNED_LOCATION>/endpoints/<id>`. Tuned
 *           endpoints sit in the multi-region "us", which the SDK reaches at aiplatform.us.rep.googleapis.com.
 * Every paid call counts against DAILY_CALL_CAP.
 */
export function createRecognizer(
  config: Config,
  clientFor: (location: string) => GenAIClient = makeClientFactory(config.gcpProject),
  log: (msg: string) => void = (m) => console.warn(m),
  countStore?: CountStore,
): Recognizer {
  const r = config.recognizer;
  if (r.mode === 'mock') return new MockRecognizer(config.mockLowConfidenceRate);

  const cap = new DailyCallCap(r.dailyCallCap, countStore);
  const shared = {
    timeoutMs: r.timeoutMs,
    maxOutputTokens: r.maxOutputTokens,
    thinkingLevel: r.thinkingLevel,
    beforeCall: () => cap.take(),
  };
  const base = new GeminiRecognizer(clientFor(r.baseLocation), r.baseModel, shared);
  if (r.mode === 'base') return base;

  const endpoint = `projects/${config.gcpProject}/locations/${r.tunedLocation}/endpoints/${r.tunedEndpointId}`;
  const tuned = new GeminiRecognizer(clientFor(r.tunedLocation), endpoint, {
    ...shared,
    modelId: `tuned:${r.tunedEndpointId}`,
  });
  if (r.fallback !== 'base') return tuned;
  return new FallbackRecognizer(tuned, base, () =>
    log('Tuned recognizer failed; answering with the base model (RECOGNIZER_FALLBACK=base).'),
  );
}

export function createServices(config: Config): Services {
  if (!config.mock) {
    const { errors } = checkLiveConfig(config);
    if (errors.length) throw new Error(errors.join(' '));
  }
  const recognizer = createRecognizer(config);
  if (config.mock) {
    return {
      mode: recognizer.modelId === 'mock' ? 'mock' : 'live',
      recognizer,
      composer: new MockComposer(),
      summarizer: new MockSummarizer(),
      ...(config.speakerMode === 'cloud'
        ? {
            voices: 'google' as const,
            speaker: new CloudSpeaker(new TextToSpeechClient() as unknown as TtsClient),
          }
        : { voices: 'mock' as const, speaker: new MockSpeaker() }),
    };
  }

  const clientFor = makeClientFactory(config.gcpProject);
  return {
    mode: 'live',
    voices: config.speakerMode === 'mock' ? 'mock' : 'google',
    recognizer,
    composer: new GeminiComposer(
      clientFor(config.compose.location),
      config.compose.model,
      undefined,
      config.compose.thinkingLevel,
    ),
    summarizer: new GeminiSummarizer(
      clientFor(config.compose.location),
      config.compose.model,
      undefined,
      config.compose.thinkingLevel,
    ),
    speaker:
      config.speakerMode === 'mock'
        ? new MockSpeaker()
        : new CloudSpeaker(new TextToSpeechClient() as unknown as TtsClient),
  };
}
