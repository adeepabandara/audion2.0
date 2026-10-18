import {
  composeRequestSchema,
  contextRequestSchema,
  feedbackRequestSchema,
  MAX_CLIP_BYTES,
  MAX_CLIP_SECONDS,
  normaliseSign,
  recognizeFieldsSchema,
  sessionRequestSchema,
  getVoice,
  speakRequestSchema,
  translateRequestSchema,
  voiceCheckRequestSchema,
  type HealthResponse,
} from '@audion/shared';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { issueToken, verifyToken } from './auth.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { RateLimiter } from './rateLimit.js';
import { isGroundedSentence } from './services/composeGuard.js';
import { composeByRules, MockComposer } from './services/mock/composer.js';
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

/**
 * How long a browser may keep a file of the web demo. The page and the model weights are checked on every visit (a
 * cheap "has it changed?" answer, so a new build shows at once); build output with a hash in its name never changes;
 * the big, rarely changing files (WebAssembly, the hand model, videos) are kept for a day; the rest for five minutes.
 */
export function webCacheControl(filePath: string): string {
  const path = filePath.replaceAll('\\', '/');
  if (path.endsWith('.html') || path.endsWith('/signclf.json')) return 'no-cache';
  if (path.includes('/assets/')) return 'public, max-age=31536000, immutable';
  if (/\.(wasm|task|mp4)$/.test(path)) return 'public, max-age=86400';
  return 'public, max-age=300';
}

export async function buildApp(
  config: Config,
  services: Services,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    // Behind Cloud Run every request arrives from Google's proxy; without this every user shares one IP bucket.
    // Trust only the hops we know about, or a client could rotate X-Forwarded-For to dodge the per-IP limits.
    trustProxy:
      config.trustProxyHops > 0
        ? (_address: string, hop: number) => hop < config.trustProxyHops
        : false,
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
  // The public web demo is served by this same service, so its requests carry our own origin.
  const sameOrigin = (origin: string, host: string | undefined) => {
    try {
      return config.webDir !== undefined && host !== undefined && new URL(origin).host === host;
    } catch {
      return false;
    }
  };
  const originAllowed = (origin: string | undefined, host?: string) =>
    !origin || allowAll || config.allowedOrigins.includes(origin) || sameOrigin(origin, host);

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
  if (config.webDir) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      cacheControl: false,
      setHeaders: (reply, filePath) =>
        void reply.header('cache-control', webCacheControl(filePath)),
    });
  }
  app.setNotFoundHandler((_req, reply) =>
    reply.status(400).send(new AppError('BAD_REQUEST', 'Unknown endpoint.').toResponse()),
  );

  app.addHook('onRequest', async (req) => {
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      throw new AppError('UNAUTHENTICATED', 'Origin not allowed.');
    }
    // Only API calls count against the limit; the web demo's files are static.
    if (req.url.startsWith('/v1/')) limiter.check(`ip:${req.ip}`, config.limits.perIp);
  });

  const authed = async (req: FastifyRequest) => {
    req.installId = await verifyToken(req.headers.authorization, config.jwtSecret);
    limiter.check(`install:${req.installId}`, config.limits.perInstall);
  };

  const health = async (): Promise<HealthResponse> => ({
    ok: true,
    mode: services.mode,
    confidenceThreshold: config.confidenceThreshold,
    modelId: services.recognizer.modelId,
    voices: services.voices,
  });
  app.get('/healthz', health);
  // Cloud Run's front end answers /healthz itself (404) on its own addresses, so clients use this path.
  app.get('/v1/health', health);

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
      // The daily cap is a deliberate refusal with its own code; anything else is the model being unavailable.
      if (e instanceof AppError && e.code === 'DAILY_CAP_REACHED') {
        req.log.warn('daily model call cap reached');
        throw e;
      }
      req.log.error(
        { errCode: (e as { code?: string }).code, upstreamStatus: (e as AppError).upstreamStatus },
        'recognizer failed',
      );
      throw new AppError('MODEL_UNAVAILABLE', 'Recognition is temporarily unavailable.');
    }
    const latencyMs = Date.now() - started;
    req.log.info(
      {
        sign: result.sign,
        confidence: result.confidence,
        latencyMs,
        modelId: result.modelId,
        clipBytes: clip.length, // size only, never content
      },
      'recognized',
    );
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
      // One sign is a fixed phrase ("Hello.", "Thank you."): no model call needed, and it saves about a second.
      sentence =
        signs.length === 1
          ? composeByRules(signs)
          : await services.composer.compose({ ...body, signs });
    } catch (e) {
      req.log.error({ errCode: (e as { code?: string }).code }, 'composer failed');
      throw new AppError('MODEL_UNAVAILABLE', 'Composing is temporarily unavailable.');
    }
    if (!isGroundedSentence(sentence, signs, body.context)) {
      req.log.warn({ signs }, 'compose output failed grounding guard; using rule-based fallback');
      sentence = await fallbackComposer.compose({ ...body, signs });
    }
    req.log.info({ signs }, 'composed');
    return { sentence };
  });

  // The meeting summary. The caption text in the body is other people's words: it is held in memory for this call,
  // never written anywhere, and never logged (only its length is).
  app.post('/v1/context', { preHandler: authed }, async (req) => {
    limiter.check(`context:${req.installId}`, config.limits.contextPerInstall);
    const body = contextRequestSchema.parse(req.body);
    let summary: string;
    try {
      summary = await services.summarizer.summarize(body);
    } catch (e) {
      req.log.error({ errCode: (e as { code?: string }).code }, 'summarizer failed');
      throw new AppError('MODEL_UNAVAILABLE', 'The meeting summary is temporarily unavailable.');
    }
    req.log.info({ transcriptChars: body.transcript.length }, 'context summarised');
    return { summary };
  });

  // Live translation of the signer's sentence. The text is held in memory for this call, never stored or logged
  // (only its length is).
  app.post('/v1/translate', { preHandler: authed }, async (req) => {
    limiter.check(`translate:${req.installId}`, config.limits.translatePerInstall);
    const body = translateRequestSchema.parse(req.body);
    let text: string;
    try {
      text = await services.translator.translate(body);
    } catch (e) {
      req.log.error({ errCode: (e as { code?: string }).code }, 'translator failed');
      throw new AppError('MODEL_UNAVAILABLE', 'Translation is temporarily unavailable.');
    }
    req.log.info({ language: body.language, chars: body.text.length }, 'translated');
    return { text };
  });

  // Voice check: speak a short line in the chosen voice and ask Google Speech-to-Text what it heard, so a signer who
  // cannot hear can see that the voice is clear. The audio stays on the server (never stored); the text is not logged.
  app.post('/v1/voice-check', { preHandler: authed }, async (req) => {
    limiter.check(`voicecheck:${req.installId}`, config.limits.voiceCheckPerInstall);
    const body = voiceCheckRequestSchema.parse(req.body);
    const voice = getVoice(body.voiceId);
    try {
      const { audio } = await services.speaker.speak(body, { linear16: true });
      const heard = await services.transcriber.transcribe({
        audio,
        languageCode: voice?.languageCode ?? 'en-US',
        hint: body.text,
      });
      req.log.info({ chars: body.text.length, heardChars: heard.length }, 'voice checked');
      return { heard, mode: services.transcriberMode };
    } catch (e) {
      req.log.error(
        { errCode: (e as { code?: string }).code, upstreamStatus: (e as AppError).upstreamStatus },
        'voice check failed',
      );
      throw new AppError('MODEL_UNAVAILABLE', 'The voice check is temporarily unavailable.');
    }
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

  // Feedback is logged as labels only (rating + sign words); nothing is stored beyond the log line.
  app.post('/v1/feedback', { preHandler: authed }, async (req, reply) => {
    const { rating, signs } = feedbackRequestSchema.parse(req.body);
    req.log.info({ rating, signs }, 'feedback');
    return reply.code(204).send();
  });

  return app;
}
