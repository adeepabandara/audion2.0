import { MAX_SPEAK_CHARS } from '@audion/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { GenAIClient } from './services/live/client.js';
import { CloudSpeaker, type TtsClient } from './services/live/speaker.js';
import { cleanTranslation, GeminiTranslator } from './services/live/translator.js';
import { getToken, makeApp } from './testUtils.js';

let app: FastifyInstance;
afterEach(async () => app?.close());

const post = (url: string, token: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${token}` },
    payload: payload as object,
  });

describe('POST /v1/translate', () => {
  it('needs a session token', async () => {
    ({ app } = await makeApp());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/translate',
      payload: { text: 'Hello.', language: 'es' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('translates a known phrase, and marks anything else as a test translation in mock mode', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const hello = await post('/v1/translate', token, { text: 'Hello.', language: 'es' });
    expect(hello.statusCode).toBe(200);
    expect(hello.json()).toEqual({ text: 'Hola.' });
    const other = await post('/v1/translate', token, { text: 'What time is it?', language: 'fr' });
    expect((other.json() as { text: string }).text).toContain('test mode');
  });

  it('rejects English as a target, unknown languages, empty and oversized text', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    expect((await post('/v1/translate', token, { text: 'Hi', language: 'en' })).statusCode).toBe(
      400,
    );
    expect((await post('/v1/translate', token, { text: 'Hi', language: 'xx' })).statusCode).toBe(
      400,
    );
    expect((await post('/v1/translate', token, { text: '', language: 'es' })).statusCode).toBe(400);
    expect(
      (
        await post('/v1/translate', token, {
          text: 'x'.repeat(MAX_SPEAK_CHARS + 1),
          language: 'es',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('is rate limited per install', async () => {
    ({ app } = await makeApp({ RATE_LIMIT_TRANSLATE_PER_INSTALL_PER_MIN: '2' }));
    const token = await getToken(app);
    const call = () => post('/v1/translate', token, { text: 'Hello.', language: 'de' });
    expect((await call()).statusCode).toBe(200);
    expect((await call()).statusCode).toBe(200);
    expect((await call()).statusCode).toBe(429);
  });

  it('never writes the sentence or its translation to the log', async () => {
    const lines: string[] = [];
    ({ app } = await makeApp({}, { write: (m) => lines.push(m) }, 'info'));
    const token = await getToken(app);
    await post('/v1/translate', token, { text: 'The secret is ZEBRA-4242.', language: 'es' });
    const log = lines.join('\n');
    expect(log).toContain('translated');
    expect(log).not.toContain('ZEBRA');
  });
});

describe('POST /v1/speak with a language', () => {
  it('accepts a supported language and rejects an unknown one', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const body = { text: 'Hola.', voiceId: 'aria', speed: 1 };
    expect((await post('/v1/speak', token, { ...body, language: 'es' })).statusCode).toBe(200);
    expect((await post('/v1/speak', token, { ...body, language: 'xx' })).statusCode).toBe(400);
  });
});

describe('CloudSpeaker with a language', () => {
  const recorder = () => {
    const calls: Array<{ voice: Record<string, unknown> }> = [];
    const client: TtsClient = {
      synthesizeSpeech: async (req) => {
        calls.push(req as never);
        return [{ audioContent: new Uint8Array([1, 2, 3]) }];
      },
    };
    return { calls, speaker: new CloudSpeaker(client) };
  };

  it('asks for the language and the voice’s gender, not an English voice name', async () => {
    const { calls, speaker } = recorder();
    await speaker.speak({ text: 'Hola.', voiceId: 'david', speed: 1, language: 'es' });
    expect(calls[0]!.voice).toEqual({ languageCode: 'es-ES', ssmlGender: 'MALE' });
  });

  it('keeps using the named English voice, and its cache, for English', async () => {
    const { calls, speaker } = recorder();
    await speaker.speak({ text: 'Hello.', voiceId: 'aria', speed: 1 });
    await speaker.speak({ text: 'Hello.', voiceId: 'aria', speed: 1, language: 'en' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.voice).toEqual({ languageCode: 'en-US', name: 'en-US-Neural2-F' });
  });

  it('does not reuse the English cache for the same text in another language', async () => {
    const { calls, speaker } = recorder();
    await speaker.speak({ text: 'Hello.', voiceId: 'aria', speed: 1 });
    await speaker.speak({ text: 'Hello.', voiceId: 'aria', speed: 1, language: 'fr' });
    expect(calls).toHaveLength(2);
  });
});

describe('GeminiTranslator', () => {
  const clientReplying = (text: string, seen: unknown[] = []) =>
    ({
      models: {
        generateContent: async (req: unknown) => {
          seen.push(req);
          return { candidates: [{ content: { parts: [{ text }] } }] };
        },
      },
    }) as unknown as GenAIClient;

  it('names the target language, treats the sentence as data and cleans the answer', async () => {
    const seen: Array<{ contents: Array<{ parts: Array<{ text: string }> }>; config: object }> = [];
    const t = new GeminiTranslator(clientReplying('Translation: “Hola, ¿qué hora es?”', seen), 'm');
    expect(await t.translate({ text: 'Hello, what time is it?', language: 'es' })).toBe(
      'Hola, ¿qué hora es?',
    );
    expect(seen[0]!.contents[0]!.parts[0]!.text).toContain('Spanish');
    expect(JSON.stringify(seen[0]!.config)).toContain('Never add, explain, answer');
  });

  it('fails clearly when the model returns nothing', async () => {
    const t = new GeminiTranslator(clientReplying('  '), 'm');
    await expect(t.translate({ text: 'Hi', language: 'de' })).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
    });
  });
});

describe('cleanTranslation', () => {
  it('strips labels, quotes and markdown and caps the length', () => {
    expect(cleanTranslation('**Translated:** "Danke."\n')).toBe('Danke.');
    expect(cleanTranslation('a '.repeat(MAX_SPEAK_CHARS)).length).toBeLessThanOrEqual(
      MAX_SPEAK_CHARS,
    );
  });
});
