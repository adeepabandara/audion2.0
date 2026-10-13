import { describe, expect, it } from 'vitest';
import {
  composeRequestSchema,
  errorResponseSchema,
  normaliseSign,
  recognizeResponseSchema,
  SIGNS,
  speakRequestSchema,
  VOICES,
} from './index.js';

describe('signs', () => {
  it('has the 22 unique vocabulary words', () => {
    expect(SIGNS).toHaveLength(22);
    expect(new Set(SIGNS).size).toBe(22);
  });

  it('normalises model output', () => {
    expect(normaliseSign(' Tomorrow. ')).toBe('tomorrow');
    expect(normaliseSign('Thank you')).toBe('thankyou');
    expect(normaliseSign('banana')).toBe('unknown');
    expect(normaliseSign('')).toBe('unknown');
  });
});

describe('voices', () => {
  it('has four en-US voices, two female and two male', () => {
    expect(VOICES).toHaveLength(4);
    expect(VOICES.filter((v) => v.gender === 'female')).toHaveLength(2);
    expect(VOICES.filter((v) => v.gender === 'male')).toHaveLength(2);
  });
});

describe('schemas', () => {
  it('rejects empty compose lists', () => {
    expect(composeRequestSchema.safeParse({ signs: [] }).success).toBe(false);
    expect(composeRequestSchema.safeParse({ signs: ['hello'] }).success).toBe(true);
  });

  it('bounds speak speed', () => {
    const base = { text: 'Hi', voiceId: 'aria' };
    expect(speakRequestSchema.safeParse({ ...base, speed: 0.7 }).success).toBe(false);
    expect(speakRequestSchema.safeParse({ ...base, speed: 1.6 }).success).toBe(false);
    expect(speakRequestSchema.safeParse({ ...base, speed: 1 }).success).toBe(true);
    expect(speakRequestSchema.safeParse({ ...base, voiceId: 'nope', speed: 1 }).success).toBe(
      false,
    );
  });

  it('allows null confidence but not invented out-of-range numbers', () => {
    const ok = { sign: 'hello', confidence: null, alternatives: [], latencyMs: 10 };
    expect(recognizeResponseSchema.safeParse(ok).success).toBe(true);
    expect(recognizeResponseSchema.safeParse({ ...ok, confidence: 1.4 }).success).toBe(false);
    expect(recognizeResponseSchema.safeParse({ ...ok, sign: 'banana' }).success).toBe(false);
  });

  it('validates the error model', () => {
    const e = { error: { code: 'RATE_LIMITED', message: 'slow down', retryable: true } };
    expect(errorResponseSchema.safeParse(e).success).toBe(true);
    expect(errorResponseSchema.safeParse({ error: { ...e.error, code: 'OOPS' } }).success).toBe(
      false,
    );
  });
});
