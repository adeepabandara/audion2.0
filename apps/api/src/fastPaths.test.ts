import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createServices } from './services/index.js';
import type { Composer } from './services/types.js';
import type { GenAIClient } from './services/live/client.js';
import { GeminiComposer } from './services/live/composer.js';
import { GeminiRecognizer } from './services/live/recognizer.js';
import { CloudSpeaker, type TtsClient } from './services/live/speaker.js';
import { getToken } from './testUtils.js';

let app: FastifyInstance;
afterEach(async () => app?.close());

async function composeWith(composer: Composer, signs: string[]) {
  const config = loadConfig({ MOCK: '1', JWT_SECRET: 'test-secret-test-secret' });
  app = await buildApp(config, { ...createServices(config), composer }, { logLevel: 'silent' });
  const token = await getToken(app);
  return app.inject({
    method: 'POST',
    url: '/v1/compose',
    headers: { authorization: `Bearer ${token}` },
    payload: { signs },
  });
}

describe('compose fast path', () => {
  it('a single sign becomes its fixed phrase without calling the model', async () => {
    const compose = vi.fn(async () => 'SHOULD NOT BE USED');
    const cases: Array<[string, string]> = [
      ['hello', 'Hello.'],
      ['thankyou', 'Thank you.'],
      ['bye', 'Goodbye.'],
      ['where', 'Where?'],
    ];
    for (const [sign, sentence] of cases) {
      const res = await composeWith({ compose }, [sign]);
      expect(res.json()).toEqual({ sentence });
      await app.close();
    }
    expect(compose).not.toHaveBeenCalled();
  });

  it('two or more signs still go to the model', async () => {
    const compose = vi.fn(async () => 'Hello, please wait.');
    const res = await composeWith({ compose }, ['hello', 'please', 'wait']);
    expect(res.json()).toEqual({ sentence: 'Hello, please wait.' });
    expect(compose).toHaveBeenCalledOnce();
  });
});

describe('voice cache', () => {
  const tts = () => {
    const synthesizeSpeech = vi.fn(async () => [{ audioContent: new Uint8Array([1, 2, 3, 4]) }]);
    return { client: { synthesizeSpeech } as unknown as TtsClient, synthesizeSpeech };
  };

  it('keeps the audio of the 22 fixed phrases in memory, per voice and speed', async () => {
    const { client, synthesizeSpeech } = tts();
    const speaker = new CloudSpeaker(client);
    await speaker.speak({ text: 'Hello.', voiceId: 'aria', speed: 1 });
    await speaker.speak({ text: 'Hello.', voiceId: 'aria', speed: 1 });
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    await speaker.speak({ text: 'Hello.', voiceId: 'david', speed: 1 }); // another voice
    await speaker.speak({ text: 'Hello.', voiceId: 'aria', speed: 1.25 }); // another speed
    expect(synthesizeSpeech).toHaveBeenCalledTimes(3);
  });

  it('never caches anything a person said (sentences outside the fixed phrases)', async () => {
    const { client, synthesizeSpeech } = tts();
    const speaker = new CloudSpeaker(client);
    for (let i = 0; i < 2; i++) {
      await speaker.speak({ text: 'Hello, please wait.', voiceId: 'aria', speed: 1 });
    }
    expect(synthesizeSpeech).toHaveBeenCalledTimes(2);
  });
});

describe('warm-up', () => {
  const reply = {
    candidates: [{ content: { parts: [{ text: 'x' }] } }],
  } as unknown as GenerateContentResponse;
  const fake = (fail = false) => {
    const calls: GenerateContentParameters[] = [];
    const client: GenAIClient = {
      models: {
        generateContent: vi.fn(async (p: GenerateContentParameters) => {
          calls.push(p);
          if (fail) throw new Error('boom');
          return reply;
        }),
      },
    };
    return { client, calls };
  };

  it('the recognizer sends a prompt-only request with a tiny answer (no video), and counts it as a paid call', async () => {
    const { client, calls } = fake();
    const before = vi.fn();
    await new GeminiRecognizer(client, 'm', {
      beforeCall: before,
      thinkingLevel: 'minimal',
    }).warmUp();
    expect(calls).toHaveLength(1);
    const parts = (calls[0]!.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]!
      .parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveProperty('text');
    expect(calls[0]!.config!.maxOutputTokens).toBe(16);
    expect(before).toHaveBeenCalledOnce();
  });

  it('the composer and speaker warm up too', async () => {
    const { client, calls } = fake();
    await new GeminiComposer(client, 'm').warmUp();
    expect(calls).toHaveLength(1);
    const synth = vi.fn(async () => [{ audioContent: new Uint8Array([1]) }]);
    const speaker = new CloudSpeaker({ synthesizeSpeech: synth } as unknown as TtsClient);
    await speaker.warmUp();
    expect(synth).toHaveBeenCalledTimes(22 * 4); // every fixed phrase, for each of the four voices
    await speaker.speak({ text: 'Thank you.', voiceId: 'miles', speed: 1 });
    expect(synth).toHaveBeenCalledTimes(22 * 4); // served from the warm cache
  });

  it('never throws: a failed warm-up must not stop the server', async () => {
    const { client } = fake(true);
    await expect(new GeminiRecognizer(client, 'm').warmUp()).resolves.toBeUndefined();
    await expect(new GeminiComposer(client, 'm').warmUp()).resolves.toBeUndefined();
    const bad = {
      synthesizeSpeech: async () => Promise.reject(new Error('boom')),
    } as unknown as TtsClient;
    await expect(new CloudSpeaker(bad).warmUp()).resolves.toBeUndefined();
  });

  it('is on by default and can be switched off', () => {
    expect(loadConfig({}).warmUp).toBe(true);
    expect(loadConfig({ WARM_UP: '0' }).warmUp).toBe(false);
  });
});
