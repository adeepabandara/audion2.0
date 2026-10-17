import { getLanguage, getVoice, SIGNS, VOICES, type SpeakRequest } from '@audion/shared';
import { AppError } from '../../errors.js';
import { composeByRules } from '../mock/composer.js';
import type { Speaker } from '../types.js';
import { TIMEOUTS, withTimeout } from './timeout.js';

/** The slice of the Cloud Text-to-Speech client we use. */
export interface TtsClient {
  synthesizeSpeech(req: {
    input: { text: string };
    voice: { languageCode: string; name?: string; ssmlGender?: 'FEMALE' | 'MALE' };
    audioConfig: {
      audioEncoding: 'MP3' | 'LINEAR16';
      speakingRate: number;
      pitch?: number;
      sampleRateHertz?: number;
    };
  }): Promise<[{ audioContent?: Uint8Array | string | null }, ...unknown[]]>;
}

/**
 * The 22 single-sign sentences ("Hello.", "Thank you.", ...). Only these are cached: they are canned phrases, not
 * anything a person said, so keeping their audio in memory stores nothing about users.
 */
const FIXED_PHRASES = new Set(SIGNS.map((s) => composeByRules([s])));
const MAX_CACHED = 200;
/** Only the four original voices are pre-generated at startup (88 calls); the others are made when first used. */
const WARM_VOICES: readonly string[] = ['aria', 'nora', 'david', 'miles'];

/** Speech with Cloud Text-to-Speech. Streams back MP3 (`audio/mpeg`). Text is never logged. */
export class CloudSpeaker implements Speaker {
  private readonly cache = new Map<string, Buffer>();

  constructor(
    private readonly client: TtsClient,
    private readonly timeoutMs: number = TIMEOUTS.speakMs,
  ) {}

  /**
   * Warm the connection and credentials, and pre-generate the 22 fixed phrases for the four original voices (about a cent in
   * total), so a single-sign sentence is spoken instantly the first time too. Best effort, 4 at a time.
   */
  async warmUp(): Promise<void> {
    const jobs = VOICES.filter((v) => WARM_VOICES.includes(v.id)).flatMap((v) =>
      [...FIXED_PHRASES].map((text) => ({ text, voiceId: v.id })),
    );
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++]!;
        await this.speak({ ...job, speed: 1 }).catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  }

  async speak(
    { text, voiceId, speed, language, pitch }: SpeakRequest,
    opts: { linear16?: boolean } = {},
  ) {
    const voice = getVoice(voiceId);
    if (!voice) throw new AppError('BAD_REQUEST', 'Unknown voice.');
    // A translated sentence: only the language code and the voice's gender are given, so Google picks one of its
    // voices for that language (no voice names to keep verified here).
    const translated =
      language !== undefined && language !== 'en' ? getLanguage(language) : undefined;
    if (language !== undefined && language !== 'en' && !translated) {
      throw new AppError('BAD_REQUEST', 'Unknown language.');
    }
    const cacheKey =
      !opts.linear16 && !translated && FIXED_PHRASES.has(text)
        ? `${voiceId}|${speed}|${pitch ?? 0}|${text}`
        : null;
    const hit = cacheKey ? this.cache.get(cacheKey) : undefined;
    if (hit) return { audio: hit, contentType: 'audio/mpeg' };
    let audio: Uint8Array | string | null | undefined;
    try {
      [{ audioContent: audio }] = await withTimeout(this.timeoutMs, () =>
        this.client.synthesizeSpeech({
          input: { text },
          voice: translated
            ? {
                languageCode: translated.tts,
                ssmlGender: voice.gender === 'female' ? 'FEMALE' : 'MALE',
              }
            : { languageCode: voice.languageCode, name: voice.ttsName },
          audioConfig: opts.linear16
            ? {
                audioEncoding: 'LINEAR16',
                speakingRate: speed,
                sampleRateHertz: 16000,
                ...(pitch ? { pitch } : {}),
              }
            : { audioEncoding: 'MP3', speakingRate: speed, ...(pitch ? { pitch } : {}) },
        }),
      );
    } catch (e) {
      throw e instanceof AppError
        ? e
        : new AppError('MODEL_UNAVAILABLE', 'Speech is temporarily unavailable.');
    }
    if (!audio || audio.length === 0)
      throw new AppError('MODEL_UNAVAILABLE', 'No audio was returned.');
    const buf = typeof audio === 'string' ? Buffer.from(audio, 'base64') : Buffer.from(audio);
    if (opts.linear16) return { audio: buf, contentType: 'audio/l16' };
    if (cacheKey) {
      if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(cacheKey, buf);
    }
    return { audio: buf, contentType: 'audio/mpeg' };
  }
}
