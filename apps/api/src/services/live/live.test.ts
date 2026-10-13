import { RECOGNIZE_PROMPT, COMPOSE_SYSTEM_PROMPT } from '@audion/shared';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../errors.js';
import { isGroundedSentence } from '../composeGuard.js';
import type { GenAIClient } from './client.js';
import { cleanSentence, GeminiComposer } from './composer.js';
import { scoreFromLogprobs, tokenToSign } from './logprobs.js';
import { GeminiRecognizer } from './recognizer.js';
import { CloudSpeaker, type TtsClient } from './speaker.js';

const tok = (token: string, p: number) => ({ token, logProbability: Math.log(p) });
const top = (...c: Array<[string, number]>) => ({ candidates: c.map(([t, p]) => tok(t, p)) });

function response(
  text: string,
  logprobs?: Partial<NonNullable<GenerateContentResponse['candidates']>[number]['logprobsResult']>,
) {
  return {
    candidates: [{ content: { parts: [{ text }] }, logprobsResult: logprobs }],
    text,
  } as unknown as GenerateContentResponse;
}

function fakeClient(...replies: Array<GenerateContentResponse | Error>) {
  const calls: GenerateContentParameters[] = [];
  const client: GenAIClient = {
    models: {
      generateContent: vi.fn(async (p: GenerateContentParameters) => {
        calls.push(p);
        const r = replies.shift();
        if (!r) throw new Error('no more replies');
        if (r instanceof Error) throw r;
        return r;
      }),
    },
  };
  return { client, calls };
}

describe('tokenToSign', () => {
  it('maps exact words and unambiguous prefixes only', () => {
    expect(tokenToSign(' Tomorrow')).toBe('tomorrow');
    expect(tokenToSign('thank')).toBe('thankyou');
    expect(tokenToSign('no')).toBe('no');
    expect(tokenToSign('wa')).toBeNull(); // too short
    expect(tokenToSign('lo')).toBeNull();
    expect(tokenToSign('banana')).toBeNull();
  });
});

describe('scoreFromLogprobs', () => {
  it('uses the answer token probability and maps alternatives to vocabulary words', () => {
    const s = scoreFromLogprobs(
      {
        chosenCandidates: [tok('tomorrow', 0.62)],
        topCandidates: [top(['tomorrow', 0.62], ['later', 0.21], ['now', 0.09], ['zebra', 0.05])],
      },
      'tomorrow',
    );
    expect(s.confidence).toBeCloseTo(0.62);
    expect(s.alternatives.map((a) => a.sign)).toEqual(['later', 'now']);
    expect(s.alternatives[0]!.confidence).toBeCloseTo(0.21);
  });

  it('multiplies token probabilities for multi-token answers', () => {
    const s = scoreFromLogprobs(
      {
        chosenCandidates: [tok('thank', 0.9), tok('you', 0.8)],
        topCandidates: [top(['thank', 0.9]), top(['you', 0.8])],
      },
      'thankyou',
    );
    expect(s.confidence).toBeCloseTo(0.72);
  });

  it('finds the answer after thinking tokens and ignores trailing whitespace tokens', () => {
    const s = scoreFromLogprobs(
      {
        chosenCandidates: [
          tok('The', 0.5),
          tok(' video', 0.4),
          tok('\n', 0.9),
          tok('hello', 0.7),
          tok('\n', 0.99),
        ],
        topCandidates: [top(), top(), top(), top(['hello', 0.7], ['bye', 0.2]), top()],
      },
      'hello',
    );
    expect(s.confidence).toBeCloseTo(0.7);
    expect(s.alternatives).toEqual([{ sign: 'bye', confidence: expect.closeTo(0.2) }]);
  });

  it('returns null confidence, never a made-up number, when it cannot align or data is missing', () => {
    expect(scoreFromLogprobs(undefined, 'hello').confidence).toBeNull();
    expect(scoreFromLogprobs({ chosenCandidates: [] }, 'hello').confidence).toBeNull();
    expect(
      scoreFromLogprobs({ chosenCandidates: [tok('something else', 0.9)] }, 'hello').confidence,
    ).toBeNull();
    expect(
      scoreFromLogprobs({ chosenCandidates: [{ token: 'hello' }] }, 'hello').confidence,
    ).toBeNull();
  });
});

describe('GeminiRecognizer', () => {
  const input = { clip: Buffer.from('CLIP-BYTES'), mime: 'video/webm' };

  it('sends the exact training prompt with the clip inline, temperature 0 and enough output tokens', async () => {
    const { client, calls } = fakeClient(
      response('tomorrow', {
        chosenCandidates: [tok('tomorrow', 0.62)],
        topCandidates: [top(['tomorrow', 0.62])],
      }),
    );
    const out = await new GeminiRecognizer(client, 'gemini-3.5-flash').recognize(input);
    const p = calls[0]!;
    expect(p.model).toBe('gemini-3.5-flash');
    const parts = (p.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]!.parts;
    expect(parts[0]).toEqual({
      inlineData: { mimeType: 'video/webm', data: Buffer.from('CLIP-BYTES').toString('base64') },
    });
    expect(parts[1]).toEqual({ text: RECOGNIZE_PROMPT });
    expect(JSON.stringify(p.contents)).not.toMatch(/hello|tomorrow/); // the vocabulary is NOT in the prompt
    expect(p.config).toMatchObject({ temperature: 0, responseLogprobs: true });
    expect(p.config!.maxOutputTokens).toBeGreaterThanOrEqual(2048);
    expect(out).toMatchObject({ sign: 'tomorrow' });
    expect(out.confidence).toBeCloseTo(0.62);
  });

  it('normalises answers and maps non-vocabulary words to unknown', async () => {
    const { client } = fakeClient(response(' Thank you. '), response('banana'));
    const r = new GeminiRecognizer(client, 'm');
    expect((await r.recognize(input)).sign).toBe('thankyou');
    expect((await r.recognize(input)).sign).toBe('unknown');
  });

  it('ignores thought parts when reading the answer', async () => {
    const res = {
      candidates: [
        {
          content: {
            parts: [{ text: 'let me think about hand shapes', thought: true }, { text: 'wait' }],
          },
        },
      ],
    } as unknown as GenerateContentResponse;
    const { client } = fakeClient(res);
    expect((await new GeminiRecognizer(client, 'm').recognize(input)).sign).toBe('wait');
  });

  it('answers unknown when the model returns nothing (e.g. output limit spent on thinking)', async () => {
    const { client } = fakeClient({
      candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }],
    } as unknown as GenerateContentResponse);
    expect(await new GeminiRecognizer(client, 'm').recognize(input)).toEqual({
      sign: 'unknown',
      confidence: null,
      alternatives: [],
    });
  });

  it('without logprobs in the response, confidence is null', async () => {
    const { client } = fakeClient(response('hello'));
    expect((await new GeminiRecognizer(client, 'm').recognize(input)).confidence).toBeNull();
  });

  it('falls back to no logprobs once if the model rejects them, and remembers', async () => {
    const { client, calls } = fakeClient(
      new Error('400 INVALID_ARGUMENT: response_logprobs is not supported for this model'),
      response('bye'),
      response('yes'),
    );
    const r = new GeminiRecognizer(client, 'tuned');
    expect(await r.recognize(input)).toMatchObject({ sign: 'bye', confidence: null });
    expect(calls[0]!.config).toHaveProperty('responseLogprobs', true);
    expect(calls[1]!.config).not.toHaveProperty('responseLogprobs');
    await r.recognize(input);
    expect(calls[2]!.config).not.toHaveProperty('responseLogprobs'); // does not retry the failing form
  });

  it('turns other Vertex failures into MODEL_UNAVAILABLE without leaking details', async () => {
    const { client } = fakeClient(
      Object.assign(new Error('PERMISSION_DENIED project-secret-123'), { status: 403 }),
    );
    await expect(new GeminiRecognizer(client, 'm').recognize(input)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof AppError && e.code === 'MODEL_UNAVAILABLE' && !e.message.includes('secret'),
    );
  });

  it('addresses a tuned model by its endpoint resource name', async () => {
    const endpoint = 'projects/123456789012/locations/us-central1/endpoints/987654321';
    const { client, calls } = fakeClient(response('hello'));
    await new GeminiRecognizer(client, endpoint).recognize(input);
    expect(calls[0]!.model).toBe(endpoint);
  });
});

describe('GeminiComposer', () => {
  it('sends glosses with the system prompt and few-shot examples, and returns a clean sentence', async () => {
    const { client, calls } = fakeClient(response('"Hello, please wait."\n'));
    const s = await new GeminiComposer(client, 'm').compose({
      signs: ['hello', 'please', 'wait'],
      tone: 'polite',
    });
    expect(s).toBe('Hello, please wait.');
    const p = calls[0]!;
    expect(p.config!.systemInstruction).toBe(COMPOSE_SYSTEM_PROMPT);
    const turns = p.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
    expect(turns.at(-1)).toEqual({
      role: 'user',
      parts: [{ text: 'Glosses: hello, please, wait\nTone: polite' }],
    });
    expect(
      turns.some(
        (t) => t.role === 'model' && t.parts[0]!.text === "We'll finish talking tomorrow.",
      ),
    ).toBe(true);
  });

  it('errors (so the route can fall back) when nothing comes back', async () => {
    const { client } = fakeClient(response('   '));
    await expect(
      new GeminiComposer(client, 'm').compose({ signs: ['hello'] }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('cleanSentence keeps the first real line and strips wrappers', () => {
    expect(cleanSentence('```\nHello.\n```')).toBe('Hello.');
    expect(cleanSentence('“Please wait.”')).toBe('Please wait.');
    expect(cleanSentence('')).toBe('');
  });

  it('few-shot examples themselves obey the grounding guard', () => {
    expect(isGroundedSentence('Hello, please wait.', ['hello', 'please', 'wait'])).toBe(true);
    expect(
      isGroundedSentence("We'll finish talking tomorrow.", ['tomorrow', 'talk', 'finish']),
    ).toBe(true);
    expect(isGroundedSentence('Thank you, goodbye.', ['thankyou', 'bye'])).toBe(true);
    expect(isGroundedSentence('Where is the time?', ['where', 'time'])).toBe(true);
  });
});

describe('CloudSpeaker', () => {
  function tts(audio: Uint8Array | string | null | Error) {
    const calls: Parameters<TtsClient['synthesizeSpeech']>[0][] = [];
    const client: TtsClient = {
      async synthesizeSpeech(req) {
        calls.push(req);
        if (audio instanceof Error) throw audio;
        return [{ audioContent: audio }];
      },
    };
    return { client, calls };
  }

  it('maps voice and speed to Cloud TTS and returns MP3', async () => {
    const { client, calls } = tts(new Uint8Array([1, 2, 3]));
    const out = await new CloudSpeaker(client).speak({
      text: 'Hello.',
      voiceId: 'david',
      speed: 1.25,
    });
    expect(calls[0]).toEqual({
      input: { text: 'Hello.' },
      voice: { languageCode: 'en-US', name: 'en-US-Neural2-D' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.25 },
    });
    expect(out.contentType).toBe('audio/mpeg');
    expect([...out.audio]).toEqual([1, 2, 3]);
  });

  it('accepts base64 audio and rejects empty audio, unknown voices and provider errors', async () => {
    const b64 = tts(Buffer.from('abc').toString('base64'));
    expect(
      (
        await new CloudSpeaker(b64.client).speak({ text: 'x', voiceId: 'aria', speed: 1 })
      ).audio.toString(),
    ).toBe('abc');
    await expect(
      new CloudSpeaker(tts(null).client).speak({ text: 'x', voiceId: 'aria', speed: 1 }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      new CloudSpeaker(tts(new Error('boom')).client).speak({
        text: 'x',
        voiceId: 'aria',
        speed: 1,
      }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    await expect(
      new CloudSpeaker(tts(new Uint8Array([1])).client).speak({
        text: 'x',
        voiceId: 'nobody' as never,
        speed: 1,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
