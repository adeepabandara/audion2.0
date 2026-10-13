import { SETTINGS_DEFAULTS } from '@audion/shared';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './api';
import { classifyMediaError, lightingFrom, meanLuminance } from './camera';
import { fromBase64, toBase64 } from './messages';
import { createSettingsStore } from './settings';
import { memoryStore } from './storage';

describe('settings store', () => {
  it('loads defaults, persists patches, and validates them', async () => {
    const backing = memoryStore();
    const { useStore, init } = createSettingsStore(backing);
    await init();
    expect(useStore.getState().ready).toBe(true);
    expect(useStore.getState().settings).toEqual(SETTINGS_DEFAULTS);

    await useStore.getState().update({ voiceId: 'miles', speed: 1.25 });
    expect(await backing.get('settings')).toMatchObject({ voiceId: 'miles', speed: 1.25 });

    await useStore.getState().update({ speed: 9 }); // out of range -> falls back, never stored raw
    expect(useStore.getState().settings.speed).toBe(1);
  });

  it('survives corrupt stored data and follows changes made elsewhere', async () => {
    const backing = memoryStore({ settings: { voiceId: 'nope', pauseMs: 2500 } });
    const { useStore, init } = createSettingsStore(backing);
    const unsub = await init();
    expect(useStore.getState().settings).toMatchObject({ voiceId: 'aria', pauseMs: 2500 });

    await backing.set('settings', { voiceId: 'david' }); // e.g. synced from another device
    expect(useStore.getState().settings.voiceId).toBe('david');
    unsub();
  });
});

describe('base64 helpers', () => {
  it('round-trips binary including large buffers', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe('camera helpers', () => {
  it('measures luminance and classifies lighting', () => {
    const dark = new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255]);
    const bright = new Uint8ClampedArray([200, 200, 200, 255, 220, 220, 220, 255]);
    expect(lightingFrom(meanLuminance(dark))).toBe('dark');
    expect(lightingFrom(meanLuminance(bright))).toBe('ok');
    expect(meanLuminance(new Uint8ClampedArray())).toBe(0);
  });

  it('maps getUserMedia errors', () => {
    expect(classifyMediaError({ name: 'NotAllowedError' })).toBe('blocked');
    expect(classifyMediaError({ name: 'NotReadableError' })).toBe('busy');
    expect(classifyMediaError({ name: 'NotFoundError' })).toBe('missing');
    expect(classifyMediaError(new Error('x'))).toBe('unknown');
  });
});

describe('api client', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('creates one install ID, reuses the token, and retries once on 401', async () => {
    const local = memoryStore();
    let sessions = 0;
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith('/v1/session')) {
        sessions++;
        return json({ token: `tok${sessions}`, expiresInSec: 900 });
      }
      const auth = (init?.headers as Record<string, string>).authorization;
      // First token is rejected (e.g. server secret rotated); the second works.
      if (auth === 'Bearer tok1')
        return json(
          { error: { code: 'UNAUTHENTICATED', message: 'expired', retryable: false } },
          401,
        );
      return json({ sentence: 'Hello, please wait.' });
    }) as unknown as typeof fetch;

    const api = createApiClient({ baseUrl: 'http://api', local, fetchImpl });
    const res = await api.compose({ signs: ['hello', 'please', 'wait'] });
    expect(res).toMatchObject({ ok: true, sentence: 'Hello, please wait.' });
    expect(sessions).toBe(2);

    await api.compose({ signs: ['hello'] }); // reuses tok2, no new session
    expect(sessions).toBe(2);
    expect(typeof (await local.get('installId'))).toBe('string');
  });

  it('turns API errors and network failures into typed failures', async () => {
    const local = memoryStore();
    const limited = (async (url: string | URL | Request) =>
      String(url).endsWith('/v1/session')
        ? json({ token: 't', expiresInSec: 900 })
        : json(
            { error: { code: 'RATE_LIMITED', message: 'slow', retryable: true } },
            429,
          )) as typeof fetch;
    expect(
      await createApiClient({ baseUrl: 'http://api', local, fetchImpl: limited }).speak({
        text: 'Hi',
        voiceId: 'aria',
        speed: 1,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'slow', retryable: true },
    });

    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: 'http://api', local, fetchImpl: down });
    expect(await api.health()).toMatchObject({
      ok: false,
      error: { code: 'NETWORK', retryable: true },
    });
    expect(await api.compose({ signs: ['hello'] })).toMatchObject({
      ok: false,
      error: { code: 'NETWORK' },
    });
  });
});
