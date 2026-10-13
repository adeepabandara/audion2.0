import { getVoice, type SpeakRequest } from '@audion/shared';
import { AppError } from '../../errors.js';
import type { Speaker } from '../types.js';

/** The slice of the Cloud Text-to-Speech client we use. */
export interface TtsClient {
  synthesizeSpeech(req: {
    input: { text: string };
    voice: { languageCode: string; name: string };
    audioConfig: { audioEncoding: 'MP3'; speakingRate: number };
  }): Promise<[{ audioContent?: Uint8Array | string | null }, ...unknown[]]>;
}

/** Speech with Cloud Text-to-Speech. Streams back MP3 (`audio/mpeg`). Text is never logged. */
export class CloudSpeaker implements Speaker {
  constructor(private readonly client: TtsClient) {}

  async speak({ text, voiceId, speed }: SpeakRequest) {
    const voice = getVoice(voiceId);
    if (!voice) throw new AppError('BAD_REQUEST', 'Unknown voice.');
    let audio: Uint8Array | string | null | undefined;
    try {
      [{ audioContent: audio }] = await this.client.synthesizeSpeech({
        input: { text },
        voice: { languageCode: voice.languageCode, name: voice.ttsName },
        audioConfig: { audioEncoding: 'MP3', speakingRate: speed },
      });
    } catch {
      throw new AppError('MODEL_UNAVAILABLE', 'Speech is temporarily unavailable.');
    }
    if (!audio || audio.length === 0)
      throw new AppError('MODEL_UNAVAILABLE', 'No audio was returned.');
    const buf = typeof audio === 'string' ? Buffer.from(audio, 'base64') : Buffer.from(audio);
    return { audio: buf, contentType: 'audio/mpeg' };
  }
}
