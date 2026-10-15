import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkLiveConfig, loadConfig } from './config.js';
import { makeApp } from './testUtils.js';

let app: FastifyInstance;
afterEach(async () => app?.close());

const WEB_DIR = fileURLToPath(new URL('../test-fixtures/web', import.meta.url));

describe('public web demo', () => {
  it('serves the web bundle when WEB_DIR is set', async () => {
    ({ app } = await makeApp({ WEB_DIR }));
    const res = await app.inject('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ola test page');
  });

  it('serves no pages without WEB_DIR', async () => {
    ({ app } = await makeApp());
    expect((await app.inject('/')).statusCode).toBe(400);
  });

  it('accepts requests from its own origin, but only with WEB_DIR set', async () => {
    ({ app } = await makeApp({ WEB_DIR, ALLOWED_ORIGINS: 'chrome-extension://abc' }));
    const own = await app.inject({
      url: '/healthz',
      headers: { host: 'ola.example.run.app', origin: 'https://ola.example.run.app' },
    });
    expect(own.statusCode).toBe(200);
    const other = await app.inject({
      url: '/healthz',
      headers: { host: 'ola.example.run.app', origin: 'https://evil.example' },
    });
    expect(other.statusCode).toBe(401);
  });

  it('rejects a same-host origin when the web demo is off', async () => {
    ({ app } = await makeApp({ ALLOWED_ORIGINS: 'chrome-extension://abc' }));
    const res = await app.inject({
      url: '/healthz',
      headers: { host: 'ola.example.run.app', origin: 'https://ola.example.run.app' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('voices and live-mode config', () => {
  it('reports the placeholder voice in mock mode and follows SPEAKER_MODE only when asked', async () => {
    ({ app } = await makeApp());
    expect((await app.inject('/healthz')).json()).toMatchObject({ voices: 'mock' });
  });

  it('SPEAKER_MODE defaults from MOCK and can be set on its own', () => {
    expect(loadConfig({ MOCK: '1' }).speakerMode).toBe('mock');
    expect(loadConfig({ MOCK: '0' }).speakerMode).toBe('cloud');
    expect(loadConfig({ MOCK: '1', SPEAKER_MODE: 'cloud' }).speakerMode).toBe('cloud');
  });

  it('live mode accepts an empty ALLOWED_ORIGINS only when it serves the web demo', () => {
    const live = {
      MOCK: '0',
      GCP_PROJECT_ID: 'p',
      JWT_SECRET: 'x'.repeat(20),
      TUNED_ENDPOINT_ID: '1',
    };
    expect(checkLiveConfig(loadConfig({ ...live })).errors.join(' ')).toMatch(/ALLOWED_ORIGINS/);
    expect(checkLiveConfig(loadConfig({ ...live, WEB_DIR: '/x' })).errors).toEqual([]);
  });
});
