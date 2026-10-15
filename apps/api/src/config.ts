import { resolve } from 'node:path';
import { DEFAULT_CONFIDENCE_THRESHOLD } from '@audion/shared';
import { z } from 'zod';

const flag = z
  .enum(['0', '1', 'true', 'false', ''])
  .default('0')
  .transform((v) => v === '1' || v === 'true');

export const RECOGNIZER_MODES = ['tuned', 'base', 'mock'] as const;
export type RecognizerMode = (typeof RECOGNIZER_MODES)[number];

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  /** GCP_PROJECT is the older name and still works. */
  GCP_PROJECT_ID: z.string().optional(),
  GCP_PROJECT: z.string().optional(),
  /** tuned | base | mock. Unset follows MOCK (MOCK=1 gives mock, otherwise base). */
  RECOGNIZER_MODE: z.enum(RECOGNIZER_MODES).optional(),
  /** Numeric ID of the tuned model's endpoint. Never hard-code it; compare checkpoints with the eval script. */
  TUNED_ENDPOINT_ID: z.string().trim().optional(),
  /** Tuned endpoints live in the multi-region "us" (host aiplatform.us.rep.googleapis.com), not us-central1. */
  TUNED_LOCATION: z.string().default('us'),
  BASE_MODEL: z.string().default('gemini-3.5-flash'),
  BASE_LOCATION: z.string().default('global'),
  /** Gemini 3.5 Flash spends output tokens on thinking, so a small limit can return an empty answer. */
  RECOGNIZE_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(65_536).default(2048),
  /** minimal|low|medium|high. Unset = the model's default, which for Gemini 3.5 Flash thinks for ~800 tokens (slow). */
  RECOGNIZE_THINKING_LEVEL: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  RECOGNIZE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  /** `base`: if the tuned call fails, answer with the base model instead. Off by default so tests see failures. */
  RECOGNIZER_FALLBACK: z.enum(['none', 'base']).default('none'),
  /** Live mode only: send one tiny request to each service at start so the first real sign is not slow. */
  WARM_UP: z
    .enum(['0', '1', 'true', 'false', ''])
    .default('1')
    .transform((v) => v === '1' || v === 'true'),
  /** Cost guard: paid model calls allowed per UTC day, per instance. */
  DAILY_CALL_CAP: z.coerce.number().int().positive().default(500),
  COMPOSE_MODEL: z.string().default('gemini-3.5-flash'),
  COMPOSE_LOCATION: z.string().default('global'),
  /** minimal|low|medium|high for the sentence step. Unset = the model's default (slower). */
  COMPOSE_THINKING_LEVEL: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(DEFAULT_CONFIDENCE_THRESHOLD),
  MOCK: flag,
  /** cloud = Google Cloud Text-to-Speech, mock = a placeholder tone. Unset follows MOCK. Lets you hear the real voices with mock recognition. */
  SPEAKER_MODE: z.enum(['cloud', 'mock']).optional(),
  MOCK_LOW_CONFIDENCE_RATE: z.coerce.number().min(0).max(1).default(0.25),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me'),
  ALLOWED_ORIGINS: z.string().default(''),
  /** Folder with the built public web demo (apps/extension/dist-web). Unset = API only. */
  WEB_DIR: z.string().optional(),
  RATE_LIMIT_PER_IP_PER_MIN: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_PER_INSTALL_PER_MIN: z.coerce.number().int().positive().default(60),
  /** Meeting summaries are a Gemini call each and the app asks about once a minute, so this is much lower. */
  RATE_LIMIT_CONTEXT_PER_INSTALL_PER_MIN: z.coerce.number().int().positive().default(6),
  // Proxies in front of the service whose X-Forwarded-For entry we trust (Cloud Run: 1). 0 = use the socket address.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  SESSION_LIMIT_PER_IP_PER_MIN: z.coerce.number().int().positive().default(10),
});

export type ThinkingLevelName = 'minimal' | 'low' | 'medium' | 'high';

export interface RecognizerConfig {
  mode: RecognizerMode;
  tunedEndpointId: string;
  tunedLocation: string;
  baseModel: string;
  baseLocation: string;
  maxOutputTokens: number;
  timeoutMs: number;
  thinkingLevel?: ThinkingLevelName;
  fallback: 'none' | 'base';
  dailyCallCap: number;
}

export interface Config {
  port: number;
  mock: boolean;
  speakerMode: 'cloud' | 'mock';
  gcpProject: string;
  recognizer: RecognizerConfig;
  compose: { model: string; location: string; thinkingLevel?: ThinkingLevelName };
  confidenceThreshold: number;
  mockLowConfidenceRate: number;
  jwtSecret: string;
  /** False when JWT_SECRET was not provided and the development default is in use. */
  jwtSecretFromEnv: boolean;
  allowedOrigins: string[];
  webDir?: string;
  limits: { perIp: number; perInstall: number; contextPerInstall: number; sessionPerIp: number };
  trustProxyHops: number;
  warmUp: boolean;
}

/** One readable line per problem instead of zod's JSON dump (the server prints this on a failed start). */
function parseEnv(env: Record<string, string | undefined>) {
  const parsed = envSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  throw new Error(
    parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; '),
  );
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const e = parseEnv(env);
  const mode: RecognizerMode = e.RECOGNIZER_MODE ?? (e.MOCK ? 'mock' : 'base');
  const tunedEndpointId = e.TUNED_ENDPOINT_ID ?? '';
  if (mode === 'tuned') {
    if (!tunedEndpointId) {
      throw new Error(
        'RECOGNIZER_MODE=tuned needs TUNED_ENDPOINT_ID (the numeric ID of the tuned model endpoint).',
      );
    }
    if (!/^\d+$/.test(tunedEndpointId)) {
      throw new Error(
        'TUNED_ENDPOINT_ID must be the numeric endpoint ID, not a full resource name.',
      );
    }
  }
  return {
    port: e.PORT,
    mock: e.MOCK,
    speakerMode: e.SPEAKER_MODE ?? (e.MOCK ? 'mock' : 'cloud'),
    gcpProject: e.GCP_PROJECT_ID ?? e.GCP_PROJECT ?? 'audion-511503',
    recognizer: {
      mode,
      tunedEndpointId,
      tunedLocation: e.TUNED_LOCATION,
      baseModel: e.BASE_MODEL,
      baseLocation: e.BASE_LOCATION,
      maxOutputTokens: e.RECOGNIZE_MAX_OUTPUT_TOKENS,
      timeoutMs: e.RECOGNIZE_TIMEOUT_MS,
      thinkingLevel: e.RECOGNIZE_THINKING_LEVEL,
      fallback: e.RECOGNIZER_FALLBACK,
      dailyCallCap: e.DAILY_CALL_CAP,
    },
    compose: {
      model: e.COMPOSE_MODEL,
      location: e.COMPOSE_LOCATION,
      thinkingLevel: e.COMPOSE_THINKING_LEVEL,
    },
    confidenceThreshold: e.CONFIDENCE_THRESHOLD,
    mockLowConfidenceRate: e.MOCK_LOW_CONFIDENCE_RATE,
    jwtSecret: e.JWT_SECRET,
    jwtSecretFromEnv: env.JWT_SECRET !== undefined && env.JWT_SECRET !== '',
    allowedOrigins: e.ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    webDir: e.WEB_DIR ? resolve(e.WEB_DIR) : undefined,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    warmUp: e.WARM_UP,
    limits: {
      perIp: e.RATE_LIMIT_PER_IP_PER_MIN,
      perInstall: e.RATE_LIMIT_PER_INSTALL_PER_MIN,
      contextPerInstall: e.RATE_LIMIT_CONTEXT_PER_INSTALL_PER_MIN,
      sessionPerIp: e.SESSION_LIMIT_PER_IP_PER_MIN,
    },
  };
}

/**
 * Settings that are fine for development but dangerous in production. Live mode (MOCK=0) refuses to start on
 * `errors` and prints `warnings`.
 */
export function checkLiveConfig(config: Config): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!config.gcpProject)
    errors.push('GCP_PROJECT_ID is required when MOCK=0 (or run with MOCK=1).');
  if (!config.jwtSecretFromEnv) {
    errors.push(
      'JWT_SECRET must be set when MOCK=0 (use a Secret Manager secret); the development default is public.',
    );
  }
  // The web demo is served by this service and accepted as its own origin, so it needs no allow-list entry.
  if (config.allowedOrigins.length === 0 && !config.webDir) {
    errors.push(
      'ALLOWED_ORIGINS must be set when MOCK=0 (and WEB_DIR is not), e.g. chrome-extension://<your-extension-id>. With it empty every request is rejected.',
    );
  } else if (config.allowedOrigins.includes('*')) {
    warnings.push(
      'ALLOWED_ORIGINS=* accepts any origin. Fine for local testing, not for production.',
    );
  }
  return { errors, warnings };
}
