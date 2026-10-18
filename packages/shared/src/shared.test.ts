import { describe, expect, it } from 'vitest';
import {
  composeRequestSchema,
  errorResponseSchema,
  normaliseSign,
  parseSettings,
  SETTINGS_DEFAULTS,
  recognizeResponseSchema,
  SIGNS,
  speakRequestSchema,
  VOICES,
} from './index.js';

describe('signs', () => {
  it('has the 40 unique vocabulary words', () => {
    expect(SIGNS).toHaveLength(40);
    expect(new Set(SIGNS).size).toBe(40);
  });

  it('normalises model output', () => {
    expect(normaliseSign(' Tomorrow. ')).toBe('tomorrow');
    expect(normaliseSign('Thank you')).toBe('thankyou');
    expect(normaliseSign('Please_Wait')).toBe('please_wait');
    expect(normaliseSign('banana')).toBe('unknown');
    expect(normaliseSign('')).toBe('unknown');
  });
});

describe('voices', () => {
  it('keeps the four original voices, and has voices in four accents of both genders', () => {
    const names = Object.fromEntries(VOICES.map((v) => [v.id, v.ttsName]));
    expect(names).toMatchObject({
      aria: 'en-US-Neural2-F',
      nora: 'en-US-Neural2-C',
      david: 'en-US-Neural2-D',
      miles: 'en-US-Neural2-J',
    });
    for (const accent of ['us', 'uk', 'in', 'au'] as const) {
      const here = VOICES.filter((v) => v.accent === accent);
      expect(here.some((v) => v.gender === 'female')).toBe(true);
      expect(here.some((v) => v.gender === 'male')).toBe(true);
    }
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

describe('settings', () => {
  it('defaults when empty, null or junk', () => {
    expect(parseSettings({})).toEqual(SETTINGS_DEFAULTS);
    expect(parseSettings(null)).toEqual(SETTINGS_DEFAULTS);
    expect(parseSettings('x')).toEqual(SETTINGS_DEFAULTS);
    expect(SETTINGS_DEFAULTS).toMatchObject({
      speakMode: 'auto',
      postToChat: false,
      monitorVoice: true,
      speed: 1,
    });
  });

  it('falls back per field, keeping valid values', () => {
    const s = parseSettings({
      voiceId: 'david',
      speed: 9,
      postToChat: 'yes',
      pauseMs: 2000,
      extra: 1,
    });
    expect(s.voiceId).toBe('david');
    expect(s.speed).toBe(1);
    expect(s.postToChat).toBe(false);
    expect(s.pauseMs).toBe(2000);
    expect('extra' in s).toBe(false);
  });
});
