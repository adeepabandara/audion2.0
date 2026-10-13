import {
  composeRequestSchema,
  MAX_CLIP_BYTES,
  MAX_CLIP_SECONDS,
  normaliseSign,
  recognizeFieldsSchema,
  sessionRequestSchema,
  speakRequestSchema,
  type HealthResponse,
} from '@audion/shared';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { issueToken, verifyToken } from './auth.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { RateLimiter } from './rateLimit.js';
import { isGroundedSentence } from './services/composeGuard.js';
import { MockComposer } from './services/mock/composer.js';
import type { Services } from './services/types.js';

export interface BuildOptions {
  /** Pino destination, for tests that assert on log content. */
  logStream?: { write(msg: string): void };
  logLevel?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    installId?: string;
  }
}

const fallbackComposer = new MockComposer();

export async function buildApp(
  config: Config,
  services: Services,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: {
      level: options.logLevel ?? process.env.LOG_LEVEL ?? 'info',
      stream: options.logStream,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        // @fastify/multipart logs the raw headers at trace level.
        'busboyOptions.headers.authorization',
        'busboyOptions.headers.cookie',
      ],
      // Only identifiers and timings: never bodies, never clip bytes.
      serializers: {
        req: (req: FastifyRequest) => ({ method: req.method, url: req.url.split('?')[0] }),
      },
    },
  });
  const limiter = new RateLimiter();
  app.addHook('onClose', async () => limiter.close());

  const allowAll = config.allowedOrigins.includes('*');
  const originAllowed = (origin: string | undefined) =>
    !origin || allowAll || config.allowedOrigins.includes(origin);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, originAllowed(origin)),
    methods: ['GET', 'POST'],
    allowedHeaders: ['authorization', 'content-type'],
  });
  await app.register(multipart, { limits: { fileSize: MAX_CLIP_BYTES, files: 1, fields: 4 } });

  app.setErrorHandler((err, req, reply) => {
    let appErr: AppError;
    if (err instanceof AppError) appErr = err;
    else if (err instanceof ZodError) {
      appErr = new AppError('BAD_REQUEST', err.issues.map((i) => i.message).join('; '));
    } else if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      appErr = new AppError('CLIP_TOO_LARGE', 'Clip exceeds the 2 MB limit.');
    } else if ((err as { statusCode?: number }).statusCode === 413) {
      appErr = new AppError('BAD_REQUEST', 'Request body too large.');
    } else if (((err as { statusCode?: number }).statusCode ?? 500) < 500) {
      appErr = new AppError('BAD_REQUEST', 'Malformed request.');
    } else {
      req.log.error({ errCode: (err as { code?: string }).code }, 'unhandled error');
      appErr = new AppError('MODEL_UNAVAILABLE', 'The service is temporarily unavailable.');
    }
    return reply.status(appErr.status).send(appErr.toResponse());
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.status(400).send(new AppError('BAD_REQUEST', 'Unknown endpoint.').toResponse()),
  );

  app.addHook('onRequest', async (req) => {
    if (!originAllowed(req.headers.origin)) {
      throw new AppError('UNAUTHENTICATED', 'Origin not allowed.');
    }
    if (req.url !== '/healthz') limiter.check(`ip:${req.ip}`, config.limits.perIp);
  });

  const authed = async (req: FastifyRequest) => {
    req.installId = await verifyToken(req.headers.authorization, config.jwtSecret);
    limiter.check(`install:${req.installId}`, config.limits.perInstall);
  };

  app.get('/healthz', async (): Promise<HealthResponse> => ({ ok: true, mode: services.mode }));

  app.post('/v1/session', async (req) => {
    limiter.check(`session:${req.ip}`, config.limits.sessionPerIp);
    const { installId } = sessionRequestSchema.parse(req.body);
    return issueToken(installId, config.jwtSecret);
  });

  app.post('/v1/recognize', { preHandler: authed }, async (req) => {
    const started = Date.now();
    const fields: Record<string, string> = {};
    let clip: Buffer | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname === 'clip') clip = await part.toBuffer();
        else part.file.resume();
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
    if (!clip || clip.length === 0) throw new AppError('BAD_REQUEST', 'Missing "clip" file.');
    const { mime, durationMs } = recognizeFieldsSchema.parse(fields);
    if (durationMs !== undefined && durationMs > MAX_CLIP_SECONDS * 1000) {
      throw new AppError('CLIP_TOO_LARGE', `Clip is longer than ${MAX_CLIP_SECONDS} seconds.`);
    }

    let result;
    try {
      result = await services.recognizer.recognize({ clip, mime });
    } catch (e) {
      req.log.error({ errCode: (e as { code?: string }).code }, 'recognizer failed');
      throw new AppError('MODEL_UNAVAILABLE', 'Recognition is temporarily unavailable.');
    }
    const latencyMs = Date.now() - started;
    req.log.info({ sign: result.sign, confidence: result.confidence, latencyMs }, 'recognized');
    return { ...result, latencyMs };
  });

  app.post('/v1/compose', { preHandler: authed }, async (req) => {
    const body = composeRequestSchema.parse(req.body);
    const signs = body.signs.map((s) => normaliseSign(s));
    if (signs.includes('unknown')) {
      throw new AppError('BAD_REQUEST', 'signs must all be words from the supported vocabulary.');
    }
    let sentence: string;
    try {
      sentence = await services.composer.compose({ ...body, signs });
    } catch (e) {
      req.log.error({ errCode: (e as { code?: string }).code }, 'composer failed');
      throw new AppError('MODEL_UNAVAILABLE', 'Composing is temporarily unavailable.');
    }
    if (!isGroundedSentence(sentence, signs)) {
      req.log.warn({ signs }, 'compose output failed grounding guard; using rule-based fallback');
      sentence = await fallbackComposer.compose({ ...body, signs });
    }
    req.log.info({ signs }, 'composed');
    return { sentence };
  });

  app.post('/v1/speak', { preHandler: authed }, async (req, reply) => {
    const body = speakRequestSchema.parse(req.body);
    try {
      const { audio, contentType } = await services.speaker.speak(body);
      return reply.type(contentType).send(audio);
    } catch (e) {
      req.log.error({ errCode: (e as { code?: string }).code }, 'speaker failed');
      throw new AppError('MODEL_UNAVAILABLE', 'Speech is temporarily unavailable.');
    }
  });

  return app;
}
