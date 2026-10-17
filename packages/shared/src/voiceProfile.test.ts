import { describe, expect, it } from 'vitest';
import {
  describeProfile,
  heightWord,
  MAX_PITCH,
  MIN_PITCH,
  pitchPosition,
  recommendProfiles,
  voiceHeight,
  type VoiceAnswers,
} from './voiceProfile.js';
import { ACCENTS, getVoice, VOICES } from './voices.js';

const base: VoiceAnswers = {
  sound: 'feminine',
  age: 'adult',
  pace: 'natural',
  tone: 'warm',
  accent: 'us',
};

describe('the voice bank', () => {
  it('has unique ids and Neural2 names that match their accent', () => {
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length);
    for (const v of VOICES) {
      expect(v.ttsName).toContain('Neural2');
      expect(v.ttsName.startsWith(v.languageCode)).toBe(true);
    }
    for (const a of ACCENTS)
      expect(VOICES.filter((v) => v.accent === a.id).length).toBeGreaterThanOrEqual(4);
  });
});

describe('recommendProfiles', () => {
  it('suggests up to three voices of the chosen gender and accent', () => {
    const r = recommendProfiles({ ...base, accent: 'uk', sound: 'masculine' });
    expect(r.length).toBe(3);
    for (const p of r) {
      expect(getVoice(p.voiceId)).toMatchObject({ gender: 'male', accent: 'uk' });
    }
  });

  it('turns the answers into pitch and pace', () => {
    const [warm] = recommendProfiles(base);
    expect(warm).toMatchObject({ pitch: -1, speed: 1 });
    const [deepCalm] = recommendProfiles({ ...base, tone: 'deep', pace: 'calm', age: 'mature' });
    expect(deepCalm).toMatchObject({ pitch: -4.5, speed: 0.9 });
    const [youngBrisk] = recommendProfiles({ ...base, tone: 'crisp', pace: 'brisk', age: 'young' });
    expect(youngBrisk).toMatchObject({ pitch: 2, speed: 1.2 });
  });

  it('"in-between" meets in the middle: a lowered female voice and a raised male voice', () => {
    const r = recommendProfiles({ ...base, sound: 'neutral' });
    const genders = r.map((p) => getVoice(p.voiceId)!.gender);
    expect(genders).toContain('female');
    expect(genders).toContain('male');
    for (const p of r) expect(heightWord(voiceHeight(p))).toBe('medium');
  });

  it('never goes outside the allowed pitch range', () => {
    for (const age of ['young', 'adult', 'mature'] as const)
      for (const tone of ['warm', 'crisp', 'deep'] as const)
        for (const sound of ['feminine', 'masculine', 'neutral'] as const)
          for (const p of recommendProfiles({ ...base, age, tone, sound })) {
            expect(p.pitch).toBeGreaterThanOrEqual(MIN_PITCH);
            expect(p.pitch).toBeLessThanOrEqual(MAX_PITCH);
          }
  });
});

describe('describeProfile', () => {
  it('says what the voice is in plain words, from measurable things only', () => {
    expect(describeProfile({ voiceId: 'aria', pitch: 0, speed: 1 })).toBe(
      'Medium-high voice, steady pace, American accent.',
    );
    expect(describeProfile({ voiceId: 'arthur', pitch: -4, speed: 0.9 })).toBe(
      'Deep voice, calm pace, British accent.',
    );
    expect(describeProfile({ voiceId: 'asha', pitch: -3, speed: 1.15 })).toBe(
      'Medium voice, brisk pace, Indian accent.',
    );
  });

  it('puts the pitch bar further right for a higher voice', () => {
    const low = pitchPosition({ voiceId: 'david', pitch: -4, speed: 1 });
    const mid = pitchPosition({ voiceId: 'david', pitch: 0, speed: 1 });
    const high = pitchPosition({ voiceId: 'aria', pitch: 4, speed: 1 });
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(high).toBeLessThanOrEqual(1);
  });
});
