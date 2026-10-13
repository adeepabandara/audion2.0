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
  allowedOrigins: string[];
  limits: { perIp: number; perInstall: number; sessionPerIp: number };
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
    allowedOrigins: e.ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    limits: {
      perIp: e.RATE_LIMIT_PER_IP_PER_MIN,
      perInstall: e.RATE_LIMIT_PER_INSTALL_PER_MIN,
      sessionPerIp: e.SESSION_LIMIT_PER_IP_PER_MIN,
    },
  };
}
