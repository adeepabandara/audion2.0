import { MAX_CLIP_BYTES, SIGNS, recognizeResponseSchema } from '@audion/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getToken, makeApp, multipartBody } from './testUtils.js';

let app: FastifyInstance;
afterEach(async () => app?.close());

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('healthz and session', () => {
  it('also answers on /v1/health (Cloud Run reserves /healthz)', async () => {
    ({ app } = await makeApp());
    const res = await app.inject('/v1/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, mode: 'mock' });
  });

  it('reports mock mode', async () => {
    ({ app } = await makeApp());
    const res = await app.inject('/healthz');
    expect(res.json()).toEqual({
      ok: true,
      mode: 'mock',
      confidenceThreshold: 0.5,
      modelId: 'mock',
      voices: 'mock',
    });
  });

  it('issues a 15 minute token and rejects bad install IDs', async () => {
    ({ app } = await makeApp());
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/session',
      payload: { installId: crypto.randomUUID() },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().expiresInSec).toBe(900);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/session',
      payload: { installId: 'me@example.com' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('BAD_REQUEST');
  });

  it('requires a valid token on v1 endpoints', async () => {
    ({ app } = await makeApp());
    const none = await app.inject({
      method: 'POST',
      url: '/v1/compose',
      payload: { signs: ['hello'] },
    });
    expect(none.statusCode).toBe(401);
    expect(none.json().error).toMatchObject({ code: 'UNAUTHENTICATED', retryable: false });
    const forged = await app.inject({
      method: 'POST',
      url: '/v1/compose',
      headers: auth('not.a.jwt'),
      payload: { signs: ['hello'] },
    });
    expect(forged.statusCode).toBe(401);
  });
});

describe('POST /v1/recognize', () => {
  it('returns a vocabulary sign with confidence', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const { payload, headers } = multipartBody(
      { mime: 'video/webm', durationMs: '1800' },
      Buffer.from('fake'),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recognize',
      headers: { ...headers, ...auth(token) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body = recognizeResponseSchema.parse(res.json());
    expect(SIGNS).toContain(body.sign);
  });

  it('cycles through the vocabulary', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const seen: string[] = [];
    for (let i = 0; i < SIGNS.length; i++) {
      const { payload, headers } = multipartBody({ mime: 'video/webm' }, Buffer.from('x'));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/recognize',
        headers: { ...headers, ...auth(token) },
        payload,
      });
      seen.push(res.json().sign);
    }
    expect(new Set(seen).size).toBe(SIGNS.length);
  });

  it('rejects clips over 2 MB with CLIP_TOO_LARGE', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const { payload, headers } = multipartBody(
      { mime: 'video/webm' },
      Buffer.alloc(MAX_CLIP_BYTES + 1),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recognize',
      headers: { ...headers, ...auth(token) },
      payload,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('CLIP_TOO_LARGE');
  });

  it('rejects clips longer than 5 seconds', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const { payload, headers } = multipartBody(
      { mime: 'video/webm', durationMs: '5001' },
      Buffer.from('x'),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recognize',
      headers: { ...headers, ...auth(token) },
      payload,
    });
    expect(res.json().error.code).toBe('CLIP_TOO_LARGE');
  });

  it('rejects a missing clip or bad mime', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const noClip = await app.inject({
      method: 'POST',
      url: '/v1/recognize',
      headers: {
        ...multipartBody({ mime: 'video/webm' }, Buffer.alloc(0)).headers,
        ...auth(token),
      },
      payload: multipartBody({ mime: 'video/webm' }, Buffer.alloc(0)).payload,
    });
    expect(noClip.json().error.code).toBe('BAD_REQUEST');
    const badMime = multipartBody({ mime: 'text/html' }, Buffer.from('x'));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recognize',
      headers: { ...badMime.headers, ...auth(token) },
      payload: badMime.payload,
    });
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });
});

describe('POST /v1/compose', () => {
  it('composes the brief examples', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const post = async (signs: string[]) =>
      (
        await app.inject({
          method: 'POST',
          url: '/v1/compose',
          headers: auth(token),
          payload: { signs },
        })
      ).json().sentence;
    expect(await post(['hello', 'please', 'wait'])).toBe('Hello, please wait.');
    expect(await post(['tomorrow', 'talk', 'finish'])).toBe("We'll finish talking tomorrow.");
    expect(await post(['where', 'time'])).toMatch(/\?$/);
  });

  it('returns 400 for empty or out-of-vocabulary signs', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    for (const signs of [[], ['banana']]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/compose',
        headers: auth(token),
        payload: { signs },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    }
  });
});

describe('POST /v1/speak', () => {
  it('returns audio and varies with speed', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const speak = (speed: number) =>
      app.inject({
        method: 'POST',
        url: '/v1/speak',
        headers: auth(token),
        payload: { text: 'Hello, please wait.', voiceId: 'aria', speed },
      });
    const slow = await speak(0.75);
    const fast = await speak(1.5);
    expect(slow.statusCode).toBe(200);
    expect(slow.headers['content-type']).toContain('audio/');
    expect(slow.rawPayload.subarray(0, 4).toString()).toBe('RIFF');
    expect(slow.rawPayload.length).toBeGreaterThan(fast.rawPayload.length);
  });

  it('validates speed and voice', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    for (const payload of [
      { text: 'Hi', voiceId: 'aria', speed: 2 },
      { text: 'Hi', voiceId: 'nobody', speed: 1 },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/speak',
        headers: auth(token),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('POST /v1/feedback', () => {
  it('accepts a rating with sign labels, and nothing else', async () => {
    ({ app } = await makeApp());
    const token = await getToken(app);
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/v1/feedback', headers: auth(token), payload });
    expect((await post({ rating: 'up', signs: ['hello', 'wait'] })).statusCode).toBe(204);
    expect((await post({ rating: 'meh', signs: [] })).statusCode).toBe(400);
    expect((await post({ rating: 'down', signs: ['not-a-sign'] })).statusCode).toBe(400);
    const none = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      payload: { rating: 'up', signs: [] },
    });
    expect(none.statusCode).toBe(401);
  });
});

describe('limits and origins', () => {
  it('rate limits per IP with RATE_LIMITED', async () => {
    ({ app } = await makeApp({ SESSION_LIMIT_PER_IP_PER_MIN: '2' }));
    const call = () =>
      app.inject({
        method: 'POST',
        url: '/v1/session',
        payload: { installId: crypto.randomUUID() },
      });
    await call();
    await call();
    const third = await call();
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  it('rate limits per install ID', async () => {
    ({ app } = await makeApp({ RATE_LIMIT_PER_INSTALL_PER_MIN: '2' }));
    const token = await getToken(app);
    const call = () =>
      app.inject({
        method: 'POST',
        url: '/v1/compose',
        headers: auth(token),
        payload: { signs: ['hello'] },
      });
    await call();
    await call();
    expect((await call()).statusCode).toBe(429);
  });

  it('only accepts allow-listed origins, never meet.google.com', async () => {
    ({ app } = await makeApp({ ALLOWED_ORIGINS: 'chrome-extension://abc' }));
    const ext = await app.inject({
      url: '/healthz',
      headers: { origin: 'chrome-extension://abc' },
    });
    expect(ext.statusCode).toBe(200);
    expect(ext.headers['access-control-allow-origin']).toBe('chrome-extension://abc');
    const meet = await app.inject({
      url: '/healthz',
      headers: { origin: 'https://meet.google.com' },
    });
    expect(meet.statusCode).toBe(401);
  });

  it('sets security headers', async () => {
    ({ app } = await makeApp());
    const res = await app.inject('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('client IP behind a proxy', () => {
  const session = (app: FastifyInstance, xff?: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/session',
      headers: xff ? { 'x-forwarded-for': xff } : {},
      payload: { installId: crypto.randomUUID() },
    });

  it('by default ignores X-Forwarded-For, so it cannot be used to dodge the per-IP limit', async () => {
    ({ app } = await makeApp({ SESSION_LIMIT_PER_IP_PER_MIN: '2' }));
    await session(app, '1.1.1.1');
    await session(app, '2.2.2.2');
    expect((await session(app, '3.3.3.3')).statusCode).toBe(429);
  });

  it('with one trusted hop (Cloud Run) limits per real client, using the entry the proxy appended', async () => {
    ({ app } = await makeApp({ SESSION_LIMIT_PER_IP_PER_MIN: '2', TRUST_PROXY_HOPS: '1' }));
    // A client-supplied first entry ("spoof-N") must not change the bucket: the proxy-added last entry does.
    await session(app, 'spoof-1, 9.9.9.9');
    await session(app, 'spoof-2, 9.9.9.9');
    expect((await session(app, 'spoof-3, 9.9.9.9')).statusCode).toBe(429);
    expect((await session(app, 'spoof-4, 8.8.8.8')).statusCode).toBe(200); // a different real client is unaffected
  });
});
