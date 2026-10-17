import { MAX_VOICE_CHECK_CHARS } from '@audion/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { CloudSpeaker, type TtsClient } from './services/live/speaker.js';
import { GoogleTranscriber, type HttpClient } from './services/live/transcriber.js';
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

const body = { text: 'Hello, I am signing with Ola.', voiceId: 'aria', speed: 1, pitch: -1 };

describe('POST /v1/voice-check', () => {
  it('needs a session token', async () => {
    ({ app } = await makeApp());
    const res = await app.inject({ method: 'POST', url: '/v1/voice-check', payload: body });
    expect(res.statusCode).toBe(401);
  });

  it('in test mode repeats the text and says it is a mock, never a real check', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const res = await post('/v1/voice-check', token, body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ heard: body.text, mode: 'mock' });
  });

  it('rejects an unknown voice, an out-of-range pitch and text that is empty or too long', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const bad = [
      { ...body, voiceId: 'nobody' },
      { ...body, pitch: 30 },
      { ...body, text: '' },
      { ...body, text: 'x'.repeat(MAX_VOICE_CHECK_CHARS + 1) },
    ];
    for (const b of bad) expect((await post('/v1/voice-check', token, b)).statusCode).toBe(400);
  });

  it('is rate limited per install', async () => {
    ({ app } = await makeApp({ RATE_LIMIT_VOICE_CHECK_PER_INSTALL_PER_MIN: '2' }));
    const token = await getToken(app);
    expect((await post('/v1/voice-check', token, body)).statusCode).toBe(200);
    expect((await post('/v1/voice-check', token, body)).statusCode).toBe(200);
    expect((await post('/v1/voice-check', token, body)).statusCode).toBe(429);
  });

  it('never writes the text or what was heard to the log', async () => {
    const lines: string[] = [];
    ({ app } = await makeApp({}, { write: (m) => lines.push(m) }, 'info'));
    const token = await getToken(app);
    await post('/v1/voice-check', token, { ...body, text: 'My secret is ZEBRA-4242.' });
    const log = lines.join('\n');
    expect(log).toContain('voice checked');
    expect(log).not.toContain('ZEBRA');
  });
});

describe('pitch in speech', () => {
  const recorder = () => {
    const calls: Array<{ audioConfig: Record<string, unknown> }> = [];
    const client: TtsClient = {
      synthesizeSpeech: async (req) => {
        calls.push(req as never);
        return [{ audioContent: new Uint8Array([1, 2, 3]) }];
      },
    };
    return { calls, speaker: new CloudSpeaker(client) };
  };

  it('passes the pitch to Google, and leaves it out when it is zero', async () => {
    const { calls, speaker } = recorder();
    await speaker.speak({ text: 'Hi there.', voiceId: 'aria', speed: 1, pitch: -3 });
    await speaker.speak({ text: 'Hi there.', voiceId: 'aria', speed: 1 });
    expect(calls[0]!.audioConfig).toMatchObject({ audioEncoding: 'MP3', pitch: -3 });
    expect(calls[1]!.audioConfig).not.toHaveProperty('pitch');
  });

  it('does not reuse a cached phrase for a different pitch', async () => {
    const { calls, speaker } = recorder();
    await speaker.speak({ text: 'Hello.', voiceId: 'aria', speed: 1 });
    await speaker.speak({ text: 'Hello.', voiceId: 'aria', speed: 1 });
    await speaker.speak({ text: 'Hello.', voiceId: 'aria', speed: 1, pitch: 2 });
    expect(calls).toHaveLength(2);
  });

  it('asks for 16 kHz linear audio, uncached, for the voice check', async () => {
    const { calls, speaker } = recorder();
    const out = await speaker.speak(
      { text: 'Hello.', voiceId: 'david', speed: 1 },
      { linear16: true },
    );
    expect(calls[0]!.audioConfig).toMatchObject({
      audioEncoding: 'LINEAR16',
      sampleRateHertz: 16000,
    });
    expect(out.contentType).toBe('audio/l16');
    await speaker.speak({ text: 'Hello.', voiceId: 'david', speed: 1 }, { linear16: true });
    expect(calls).toHaveLength(2);
  });
});

describe('GoogleTranscriber', () => {
  const clientReplying = (data: unknown, seen: unknown[] = []): HttpClient => ({
    request: async (opts) => {
      seen.push(opts);
      return { data } as never;
    },
  });

  it('sends 16 kHz LINEAR16 audio with the accent’s language code and joins the transcript', async () => {
    const seen: Array<{ url: string; data: { config: object; audio: { content: string } } }> = [];
    const t = new GoogleTranscriber(
      clientReplying(
        {
          results: [
            { alternatives: [{ transcript: 'Hello, I am' }] },
            { alternatives: [{ transcript: ' signing with Ola.' }] },
          ],
        },
        seen,
      ),
    );
    const heard = await t.transcribe({ audio: Buffer.from([1, 2, 3]), languageCode: 'en-GB' });
    expect(heard).toBe('Hello, I am signing with Ola.');
    expect(seen[0]!.url).toBe('https://speech.googleapis.com/v1/speech:recognize');
    expect(seen[0]!.data.config).toMatchObject({
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'en-GB',
    });
    expect(seen[0]!.data.audio.content).toBe(Buffer.from([1, 2, 3]).toString('base64'));
  });

  it('returns nothing heard when Google found no speech', async () => {
    const t = new GoogleTranscriber(clientReplying({}));
    expect(await t.transcribe({ audio: Buffer.from([0]), languageCode: 'en-US' })).toBe('');
  });

  it('turns any upstream failure into MODEL_UNAVAILABLE', async () => {
    const t = new GoogleTranscriber({
      request: async () => {
        throw new Error('403 API not enabled');
      },
    });
    await expect(
      t.transcribe({ audio: Buffer.from([0]), languageCode: 'en-US' }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });

  it('keeps Google’s HTTP status for the server log (a disabled API is a 403)', async () => {
    const t = new GoogleTranscriber({
      request: async () => {
        throw Object.assign(new Error('forbidden'), { response: { status: 403 } });
      },
    });
    await expect(
      t.transcribe({ audio: Buffer.from([0]), languageCode: 'en-US' }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE', upstreamStatus: 403 });
  });
});
