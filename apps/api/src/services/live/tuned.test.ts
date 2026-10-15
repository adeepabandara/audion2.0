import { RECOGNIZE_PROMPT } from '@audion/shared';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config.js';
import { AppError } from '../../errors.js';
import { DailyCallCap, type CountStore, type DayCount } from '../callCap.js';
import { createRecognizer } from '../index.js';
import { parseAnswer } from './answer.js';
import type { GenAIClient } from './client.js';
import { GeminiRecognizer, isTransient } from './recognizer.js';

const input = { clip: Buffer.from('CLIP'), mime: 'video/mp4' };
const reply = (text: string) =>
  ({
    candidates: [{ content: { parts: [{ text }] } }],
    text,
  }) as unknown as GenerateContentResponse;
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function fake(...replies: Array<GenerateContentResponse | Error | 'hang'>) {
  const calls: GenerateContentParameters[] = [];
  const client: GenAIClient = {
    models: {
      generateContent: vi.fn((p: GenerateContentParameters) => {
        calls.push(p);
        const r = replies.shift();
        if (r === 'hang') return new Promise<GenerateContentResponse>(() => {});
        if (!r) return Promise.reject(new Error('no more replies'));
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
      }),
    },
  };
  return { client, calls };
}

describe('parseAnswer', () => {
  it.each([
    ['hello', 'hello'],
    ['  Hello.  ', 'hello'],
    ['HELLO!', 'hello'],
    ['thankyou', 'thankyou'],
    ['Thank you', 'thankyou'],
    ['thank-you.', 'thankyou'],
    ['The sign is hello.', 'hello'],
    ['I think it is: thank you', 'thankyou'],
    ['no\n', 'no'],
  ])('reads %j as %s', (raw, sign) => {
    expect(parseAnswer(raw)).toEqual({ sign });
  });

  it('answers unknown for an empty or punctuation-only answer', () => {
    for (const raw of ['', '   ', '\n', '...', '!?']) {
      expect(parseAnswer(raw)).toEqual({ sign: 'unknown', reason: 'empty' });
    }
  });

  it('answers unknown for words outside the 22 signs, including signs we do not support', () => {
    for (const raw of ['banana', 'help', 'hello world', 'I do not know', 'good']) {
      expect(parseAnswer(raw)).toEqual({ sign: 'unknown', reason: 'out_of_vocabulary' });
    }
  });
});

describe('DailyCallCap', () => {
  const at = (iso: string) => () => new Date(iso);

  it('allows exactly `cap` calls per UTC day, then refuses with a clear, non-retryable error', () => {
    const cap = new DailyCallCap(2, undefined, at('2026-10-14T10:00:00Z'));
    cap.take();
    cap.take();
    expect(cap.used).toBe(2);
    expect(() => cap.take()).toThrow(AppError);
    try {
      cap.take();
    } catch (e) {
      expect(e).toMatchObject({ code: 'DAILY_CAP_REACHED' });
      expect((e as AppError).toResponse().error.retryable).toBe(false);
      expect((e as AppError).message).toMatch(/daily limit of 2/);
    }
    expect(cap.used).toBe(2); // refused calls are not counted
  });

  it('starts again at midnight UTC', () => {
    let now = new Date('2026-10-14T23:59:59Z');
    const cap = new DailyCallCap(1, undefined, () => now);
    cap.take();
    expect(() => cap.take()).toThrow(/daily limit/);
    now = new Date('2026-10-15T00:00:01Z');
    expect(cap.used).toBe(0);
    expect(() => cap.take()).not.toThrow();
  });

  it('keeps the count in a store (dev scripts) and ignores a stale day', () => {
    let saved: DayCount | null = { day: '2026-10-14', count: 1 };
    const store: CountStore = { load: () => saved, save: (s) => void (saved = { ...s }) };
    const cap = new DailyCallCap(2, store, at('2026-10-14T08:00:00Z'));
    expect(cap.used).toBe(1);
    cap.take();
    expect(saved).toEqual({ day: '2026-10-14', count: 2 });
    expect(() => cap.take()).toThrow(/daily limit/);

    saved = { day: '2026-10-13', count: 99 };
    expect(new DailyCallCap(2, store, at('2026-10-14T08:00:00Z')).used).toBe(0);
  });
});

describe('GeminiRecognizer: tuned endpoint behaviour', () => {
  it('sends the training prompt verbatim with the clip and the configured token limit', async () => {
    const { client, calls } = fake(reply('hello'));
    await new GeminiRecognizer(client, 'm', { maxOutputTokens: 4096 }).recognize(input);
    const parts = (calls[0]!.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]!
      .parts;
    expect(parts[1]).toEqual({ text: RECOGNIZE_PROMPT });
    expect(parts[0]).toEqual({
      inlineData: { mimeType: 'video/mp4', data: Buffer.from('CLIP').toString('base64') },
    });
    expect(calls[0]!.config).toMatchObject({ temperature: 0, maxOutputTokens: 4096 });
  });

  it('sends a thinking level only when one is configured', async () => {
    const a = fake(reply('yes'));
    await new GeminiRecognizer(a.client, 'm', { thinkingLevel: 'minimal' }).recognize(input);
    expect(a.calls[0]!.config).toMatchObject({ thinkingConfig: { thinkingLevel: 'MINIMAL' } });
    const b = fake(reply('yes'));
    await new GeminiRecognizer(b.client, 'm').recognize(input);
    expect(b.calls[0]!.config).not.toHaveProperty('thinkingConfig');
  });

  it('reports which model answered', async () => {
    const { client } = fake(reply('yes'));
    const out = await new GeminiRecognizer(client, 'projects/1/locations/us/endpoints/9', {
      modelId: 'tuned:9',
    }).recognize(input);
    expect(out.modelId).toBe('tuned:9');
  });

  it('retries a 429 once and returns the second answer', async () => {
    const { client, calls } = fake(httpError(429), reply('wait'));
    expect((await new GeminiRecognizer(client, 'm').recognize(input)).sign).toBe('wait');
    expect(calls).toHaveLength(2);
  });

  it('retries a 5xx once, then gives up with MODEL_UNAVAILABLE (never a third call)', async () => {
    const { client, calls } = fake(httpError(503), httpError(503), reply('wait'));
    await expect(new GeminiRecognizer(client, 'm').recognize(input)).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      upstreamStatus: 503,
    });
    expect(calls).toHaveLength(2);
  });

  it('retries after a timeout', async () => {
    const { client, calls } = fake('hang', reply('bye'));
    const out = await new GeminiRecognizer(client, 'm', { timeoutMs: 30 }).recognize(input);
    expect(out.sign).toBe('bye');
    expect(calls).toHaveLength(2);
  });

  it('gives up after two timeouts', async () => {
    const { client, calls } = fake('hang', 'hang');
    await expect(
      new GeminiRecognizer(client, 'm', { timeoutMs: 30 }).recognize(input),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE', upstreamStatus: 408 });
    expect(calls).toHaveLength(2);
  });

  it.each([400, 401, 403, 404])(
    'does not retry a %i (the request or endpoint is wrong)',
    async (status) => {
      const { client, calls } = fake(httpError(status), reply('yes'));
      await expect(new GeminiRecognizer(client, 'm').recognize(input)).rejects.toMatchObject({
        code: 'MODEL_UNAVAILABLE',
        upstreamStatus: status,
      });
      expect(calls).toHaveLength(1);
    },
  );

  it('classifies transient errors', () => {
    expect(isTransient(httpError(429))).toBe(true);
    expect(isTransient(httpError(500))).toBe(true);
    expect(isTransient(new Error('socket hang up'))).toBe(true);
    expect(isTransient(httpError(404))).toBe(false);
  });

  it('an empty answer is "unknown" with no confidence', async () => {
    const { client } = fake({
      candidates: [{ content: { parts: [] } }],
    } as unknown as GenerateContentResponse);
    expect(await new GeminiRecognizer(client, 'm').recognize(input)).toMatchObject({
      sign: 'unknown',
      confidence: null,
    });
  });

  it('asks beforeCall before each paid request, and a refusal means no request is sent', async () => {
    const before = vi.fn();
    const { client, calls } = fake(httpError(429), reply('yes'));
    await new GeminiRecognizer(client, 'm', { beforeCall: before }).recognize(input);
    expect(before).toHaveBeenCalledTimes(2); // the retry is a paid call too
    expect(calls).toHaveLength(2);

    const refuse = () => {
      throw new AppError('DAILY_CAP_REACHED', 'cap');
    };
    const none = fake(reply('yes'));
    await expect(
      new GeminiRecognizer(none.client, 'm', { beforeCall: refuse }).recognize(input),
    ).rejects.toMatchObject({ code: 'DAILY_CAP_REACHED' });
    expect(none.calls).toHaveLength(0);
  });
});

describe('createRecognizer', () => {
  const cfg = (env: Record<string, string>) => loadConfig({ JWT_SECRET: 'x'.repeat(20), ...env });

  function factory(client: GenAIClient) {
    const locations: string[] = [];
    return {
      locations,
      clientFor: (location: string) => (locations.push(location), client),
    };
  }

  it('tuned mode calls the endpoint resource in the "us" location', async () => {
    const { client, calls } = fake(reply('hello'));
    const f = factory(client);
    const r = createRecognizer(
      cfg({ RECOGNIZER_MODE: 'tuned', TUNED_ENDPOINT_ID: '4242', GCP_PROJECT_ID: 'proj' }),
      f.clientFor,
    );
    const out = await r.recognize(input);
    expect(calls[0]!.model).toBe('projects/proj/locations/us/endpoints/4242');
    expect(f.locations).toContain('us');
    expect(out).toMatchObject({ sign: 'hello', modelId: 'tuned:4242' });
  });

  it('base mode calls the base model on the global endpoint', async () => {
    const { client, calls } = fake(reply('hello'));
    const f = factory(client);
    await createRecognizer(cfg({ RECOGNIZER_MODE: 'base' }), f.clientFor).recognize(input);
    expect(calls[0]!.model).toBe('gemini-3.5-flash');
    expect(f.locations).toEqual(['global']);
  });

  it('mock mode never builds a Google client', async () => {
    const clientFor = vi.fn();
    const out = await createRecognizer(cfg({ RECOGNIZER_MODE: 'mock' }), clientFor).recognize(
      input,
    );
    expect(out.modelId).toBe('mock');
    expect(clientFor).not.toHaveBeenCalled();
  });

  it('does NOT fall back to the base model unless asked (failures stay visible)', async () => {
    const { client, calls } = fake(httpError(404), reply('hello'));
    const r = createRecognizer(
      cfg({ RECOGNIZER_MODE: 'tuned', TUNED_ENDPOINT_ID: '1' }),
      () => client,
    );
    await expect(r.recognize(input)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    expect(calls).toHaveLength(1);
  });

  it('with RECOGNIZER_FALLBACK=base, answers with the base model and says so', async () => {
    const { client } = fake(httpError(404), reply('wait'));
    const log = vi.fn();
    const r = createRecognizer(
      cfg({ RECOGNIZER_MODE: 'tuned', TUNED_ENDPOINT_ID: '1', RECOGNIZER_FALLBACK: 'base' }),
      () => client,
      log,
    );
    const out = await r.recognize(input);
    expect(out).toMatchObject({ sign: 'wait', modelId: 'gemini-3.5-flash' });
    expect(log).toHaveBeenCalledOnce();
  });

  it('enforces DAILY_CALL_CAP across calls, and the fallback cannot bypass it', async () => {
    const { client, calls } = fake(reply('yes'), reply('no'), reply('hello'));
    const r = createRecognizer(
      cfg({
        RECOGNIZER_MODE: 'tuned',
        TUNED_ENDPOINT_ID: '1',
        RECOGNIZER_FALLBACK: 'base',
        DAILY_CALL_CAP: '2',
      }),
      () => client,
    );
    await r.recognize(input);
    await r.recognize(input);
    await expect(r.recognize(input)).rejects.toMatchObject({ code: 'DAILY_CAP_REACHED' });
    expect(calls).toHaveLength(2);
  });
});
