import { MAX_SPEED, MIN_SPEED } from './constants.js';
import { ACCENTS, getVoice, VOICES, type Accent, type VoiceId } from './voices.js';

/** How far (in semitones) a voice may be shifted. Cloud Text-to-Speech allows more; this stays natural. */
export const MIN_PITCH = -8;
export const MAX_PITCH = 8;

/** A signer's voice: which voice, how much higher or lower, how fast. This is what is saved in settings. */
export interface VoiceProfile {
  voiceId: VoiceId;
  /** Semitones, MIN_PITCH..MAX_PITCH. */
  pitch: number;
  speed: number;
}

/** The answers to the setup questions. */
export interface VoiceAnswers {
  sound: 'feminine' | 'masculine' | 'neutral';
  age: 'young' | 'adult' | 'mature';
  pace: 'calm' | 'natural' | 'brisk';
  tone: 'warm' | 'crisp' | 'deep';
  accent: Accent;
}

const AGE_PITCH = { young: 1.5, adult: 0, mature: -1.5 } as const;
const TONE_PITCH = { warm: -1, crisp: 0.5, deep: -3 } as const;
const PACE_SPEED = { calm: 0.9, natural: 1, brisk: 1.15 } as const;
const TONE_SPEED = { warm: 0, crisp: 0.05, deep: 0 } as const;
/** "In-between": a female voice is lowered and a male voice raised so they meet in the middle. */
const NEUTRAL_PITCH = { female: -2, male: 3 } as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const half = (n: number) => Math.round(n * 2) / 2;

/** Up to three voices that fit the answers, each with the pitch and pace the answers ask for. */
export function recommendProfiles(a: VoiceAnswers): VoiceProfile[] {
  const pool = VOICES.filter((v) => v.accent === a.accent);
  const picks =
    a.sound === 'neutral'
      ? [
          pool.filter((v) => v.gender === 'female')[0],
          pool.filter((v) => v.gender === 'male')[0],
          pool.filter((v) => v.gender === 'female')[1],
        ]
      : pool.filter((v) => v.gender === (a.sound === 'feminine' ? 'female' : 'male')).slice(0, 3);
  const speed = clamp(
    Math.round((PACE_SPEED[a.pace] + TONE_SPEED[a.tone]) * 100) / 100,
    MIN_SPEED,
    MAX_SPEED,
  );
  return picks
    .filter((v): v is NonNullable<typeof v> => v !== undefined)
    .map((v) => ({
      voiceId: v.id,
      pitch: clamp(
        half(
          AGE_PITCH[a.age] +
            TONE_PITCH[a.tone] +
            (a.sound === 'neutral' ? NEUTRAL_PITCH[v.gender] : 0),
        ),
        MIN_PITCH,
        MAX_PITCH,
      ),
      speed,
    }));
}

/**
 * How high the voice is, on a scale of about -12 (very deep) to +12 (very high): a female voice starts high and a
 * male voice low, and the pitch change moves it. Used for the words and for the pitch bar.
 */
export function voiceHeight(p: VoiceProfile): number {
  const gender = getVoice(p.voiceId)?.gender ?? 'female';
  return (gender === 'female' ? 4 : -4) + p.pitch;
}

export function heightWord(h: number): string {
  if (h <= -7) return 'deep';
  if (h <= -3) return 'low';
  if (h < 2) return 'medium';
  if (h <= 6) return 'medium-high';
  return 'high';
}

export function paceWord(speed: number): string {
  if (speed < 0.85) return 'slow pace';
  if (speed < 0.95) return 'calm pace';
  if (speed < 1.1) return 'steady pace';
  if (speed < 1.3) return 'brisk pace';
  return 'fast pace';
}

/** The voice in plain words, from what can be measured (no claim about how the voice "feels"). */
export function describeProfile(p: VoiceProfile): string {
  const accent = ACCENTS.find((x) => x.id === getVoice(p.voiceId)?.accent)?.label ?? '';
  const text = `${heightWord(voiceHeight(p))} voice, ${paceWord(p.speed)}, ${accent} accent`;
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}

/** Where the voice sits between deep (0) and high (1), for the pitch bar. */
export function pitchPosition(p: VoiceProfile): number {
  return clamp((voiceHeight(p) + 12) / 24, 0, 1);
}
