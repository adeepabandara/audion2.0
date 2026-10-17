import { GoogleAuth } from 'google-auth-library';
import { AppError } from '../../errors.js';
import type { Transcriber } from '../types.js';
import { TIMEOUTS, withTimeout } from './timeout.js';

/** The slice of the Google auth client used here: an authorised HTTPS request. */
export interface HttpClient {
  request<T>(opts: {
    url: string;
    method: 'POST';
    data: unknown;
    signal?: AbortSignal;
  }): Promise<{ data: T }>;
}

interface RecognizeResponse {
  results?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
}

const ENDPOINT = 'https://speech.googleapis.com/v1/speech:recognize';

/**
 * Google Cloud Speech-to-Text (v1 REST, through Application Default Credentials: no key, no extra client library).
 * Used only by the voice check, to tell a signer who cannot hear what their chosen voice sounds like to others.
 * The audio and the transcript are held in memory for the call and never stored or logged.
 */
export class GoogleTranscriber implements Transcriber {
  constructor(
    private readonly client: HttpClient,
    private readonly timeoutMs: number = TIMEOUTS.speakMs,
  ) {}

  async transcribe({ audio, languageCode }: { audio: Buffer; languageCode: string }) {
    try {
      const res = await withTimeout(this.timeoutMs, (signal) =>
        this.client.request<RecognizeResponse>({
          url: ENDPOINT,
          method: 'POST',
          signal,
          data: {
            config: {
              encoding: 'LINEAR16',
              sampleRateHertz: 16000,
              languageCode,
              enableAutomaticPunctuation: true,
            },
            audio: { content: audio.toString('base64') },
          },
        }),
      );
      return (res.data.results ?? [])
        .map((r) => r.alternatives?.[0]?.transcript ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    } catch (e) {
      if (e instanceof AppError) throw e;
      // Google's HTTP status is logged server-side (never sent to the client) so a disabled API or a missing
      // permission shows up as 403 in the logs instead of a bare "unavailable".
      const status = (e as { response?: { status?: number } }).response?.status;
      throw new AppError(
        'MODEL_UNAVAILABLE',
        'Speech recognition is temporarily unavailable.',
        status,
      );
    }
  }
}

/** The real client: Application Default Credentials (the Cloud Run service account), no key file. */
export function createSpeechClient(): HttpClient {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return {
    async request(opts) {
      const client = await auth.getClient();
      return client.request(opts) as never;
    },
  };
}
