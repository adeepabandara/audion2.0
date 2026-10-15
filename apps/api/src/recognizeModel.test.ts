import { recognizeResponseSchema } from '@audion/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { AppError } from './errors.js';
import { createServices } from './services/index.js';
import type { Recognizer } from './services/types.js';
import { getToken, multipartBody } from './testUtils.js';

let app: FastifyInstance;
afterEach(async () => app?.close());

async function appWith(recognizer?: Recognizer) {
  const config = loadConfig({ MOCK: '1', JWT_SECRET: 'test-secret-test-secret' });
  const services = createServices(config);
  app = await buildApp(config, recognizer ? { ...services, recognizer } : services, {
    logLevel: 'silent',
  });
  return getToken(app);
}

async function recognize(token: string) {
  const { payload, headers } = multipartBody({ mime: 'video/webm' }, Buffer.from('clip'));
  return app.inject({
    method: 'POST',
    url: '/v1/recognize',
    headers: { ...headers, authorization: `Bearer ${token}` },
    payload,
  });
}

describe('which model answered', () => {
  it('the recognize response carries modelId, and the health check reports the configured one', async () => {
    const token = await appWith();
    const res = await recognize(token);
    expect(res.statusCode).toBe(200);
    expect(recognizeResponseSchema.parse(res.json()).modelId).toBe('mock');
    expect((await app.inject('/healthz')).json()).toMatchObject({ modelId: 'mock' });
  });

  it('reaching the daily cap is a 429 DAILY_CAP_REACHED that clients must not retry', async () => {
    const capped: Recognizer = {
      modelId: 'tuned:1',
      recognize: async () => {
        throw new AppError('DAILY_CAP_REACHED', 'The daily limit of 500 model calls was reached.');
      },
    };
    const token = await appWith(capped);
    const res = await recognize(token);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      error: {
        code: 'DAILY_CAP_REACHED',
        message: expect.stringMatching(/daily limit/),
        retryable: false,
      },
    });
  });

  it('other recognizer failures stay MODEL_UNAVAILABLE and leak nothing', async () => {
    const broken: Recognizer = {
      modelId: 'tuned:1',
      recognize: async () => {
        throw new AppError('MODEL_UNAVAILABLE', 'internal detail projects/secret', 404);
      },
    };
    const token = await appWith(broken);
    const res = await recognize(token);
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.json())).not.toMatch(/secret|404/);
  });
});
