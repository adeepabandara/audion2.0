import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { createServices } from './services/index.js';

export async function makeApp(
  overrides: Record<string, string> = {},
  logStream?: { write(msg: string): void },
  logLevel = 'silent',
): Promise<{ app: FastifyInstance; config: Config }> {
  const config = loadConfig({
    MOCK: '1',
    JWT_SECRET: 'test-secret-test-secret',
    MOCK_LOW_CONFIDENCE_RATE: '0',
    ...overrides,
  });
  const app = await buildApp(config, createServices(config), { logStream, logLevel });
  return { app, config };
}

export async function getToken(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/session',
    payload: { installId: crypto.randomUUID() },
  });
  return (res.json() as { token: string }).token;
}

export function multipartBody(
  fields: Record<string, string>,
  clip: Buffer,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----audion-test-boundary';
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="clip"; filename="clip.webm"\r\nContent-Type: video/webm\r\n\r\n`,
    ),
    clip,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
