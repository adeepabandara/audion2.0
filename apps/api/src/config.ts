import { DEFAULT_CONFIDENCE_THRESHOLD } from '@audion/shared';
import { z } from 'zod';

const flag = z
  .enum(['0', '1', 'true', 'false', ''])
  .default('0')
  .transform((v) => v === '1' || v === 'true');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  GCP_PROJECT: z.string().default(''),
  RECOGNIZE_MODEL: z.string().default('gemini-3.5-flash'),
  RECOGNIZE_LOCATION: z.string().default('global'),
  COMPOSE_MODEL: z.string().default('gemini-3.5-flash'),
  COMPOSE_LOCATION: z.string().default('global'),
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(DEFAULT_CONFIDENCE_THRESHOLD),
  MOCK: flag,
  MOCK_LOW_CONFIDENCE_RATE: z.coerce.number().min(0).max(1).default(0.25),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me'),
  ALLOWED_ORIGINS: z.string().default(''),
  RATE_LIMIT_PER_IP_PER_MIN: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_PER_INSTALL_PER_MIN: z.coerce.number().int().positive().default(60),
  // Proxies in front of the service whose X-Forwarded-For entry we trust (Cloud Run: 1). 0 = use the socket address.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  SESSION_LIMIT_PER_IP_PER_MIN: z.coerce.number().int().positive().default(10),
});

export interface Config {
  port: number;
  mock: boolean;
  gcpProject: string;
  recognize: { model: string; location: string };
  compose: { model: string; location: string };
  confidenceThreshold: number;
  mockLowConfidenceRate: number;
  jwtSecret: string;
  /** False when JWT_SECRET was not provided and the development default is in use. */
  jwtSecretFromEnv: boolean;
  allowedOrigins: string[];
  limits: { perIp: number; perInstall: number; sessionPerIp: number };
  trustProxyHops: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const e = envSchema.parse(env);
  return {
    port: e.PORT,
    mock: e.MOCK,
    gcpProject: e.GCP_PROJECT,
    recognize: { model: e.RECOGNIZE_MODEL, location: e.RECOGNIZE_LOCATION },
    compose: { model: e.COMPOSE_MODEL, location: e.COMPOSE_LOCATION },
    confidenceThreshold: e.CONFIDENCE_THRESHOLD,
    mockLowConfidenceRate: e.MOCK_LOW_CONFIDENCE_RATE,
    jwtSecret: e.JWT_SECRET,
    jwtSecretFromEnv: env.JWT_SECRET !== undefined && env.JWT_SECRET !== '',
    allowedOrigins: e.ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxyHops: e.TRUST_PROXY_HOPS,
    limits: {
      perIp: e.RATE_LIMIT_PER_IP_PER_MIN,
      perInstall: e.RATE_LIMIT_PER_INSTALL_PER_MIN,
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
  if (!config.gcpProject) errors.push('GCP_PROJECT is required when MOCK=0 (or run with MOCK=1).');
  if (!config.jwtSecretFromEnv) {
    errors.push(
      'JWT_SECRET must be set when MOCK=0 (use a Secret Manager secret); the development default is public.',
    );
  }
  if (config.allowedOrigins.length === 0) {
    errors.push(
      'ALLOWED_ORIGINS must be set when MOCK=0, e.g. chrome-extension://<your-extension-id>. With it empty every request is rejected.',
    );
  } else if (config.allowedOrigins.includes('*')) {
    warnings.push(
      'ALLOWED_ORIGINS=* accepts any origin. Fine for local testing, not for production.',
    );
  }
  return { errors, warnings };
}
