import { MAX_SPEAK_CHARS } from './constants.js';
import { MAX_PITCH, MIN_PITCH, type VoiceProfile } from './voiceProfile.js';
import { MAX_SPEED, MIN_SPEED } from './constants.js';

/**
 * "Ask someone to listen": message templates for sharing a voice note with a person you trust, and the quick replies
 * that person can give. The voice note is the message itself, spoken in the voice being checked.
 */
export interface ShareTemplate {
  id: 'family' | 'friend' | 'colleague' | 'quick';
  label: string;
  /** Who it suits, one short line. */
  blurb: string;
  /** `{to}` becomes " Name" (or nothing) and `{from}` becomes "your name" (or the sign-off is dropped). */
  text: string;
}

export const SHARE_TEMPLATES: ShareTemplate[] = [
  {
    id: 'family',
    label: 'Family',
    blurb: 'Warm and simple',
    text: 'Hi{to}! 💛 I’m choosing my voice in Ola, an app that speaks for me in video calls. This voice note is my new voice reading you this message. Does it sound like me? Reply 👍 if yes, or tell me: higher ⏫, lower ⏬, faster ⏩ or slower ⏪. Thank you! — {from}',
  },
  {
    id: 'friend',
    label: 'Friend',
    blurb: 'Relaxed',
    text: 'Hey{to}! 🎧 Quick favour: I’m picking a voice for Ola, the app that talks for me in meetings. Press play and tell me honestly, does this sound like me? 👍 yes, ⏫ higher, ⏬ lower, ⏩ faster, ⏪ slower. Thanks! — {from}',
  },
  {
    id: 'colleague',
    label: 'Colleague',
    blurb: 'Polite and clear',
    text: 'Hello{to}, I’m setting up Ola, a tool that lets me speak in our meetings. This voice note is the voice you may hear from me. Could you let me know whether it is clear and easy to follow? Reply 👍 if it is, or tell me if it should be higher ⏫, lower ⏬, faster ⏩ or slower ⏪. Thank you. — {from}',
  },
  {
    id: 'quick',
    label: 'Quick check',
    blurb: 'Just the question',
    text: 'Does this sound like me? 👍 yes · ⏫ higher · ⏬ lower · ⏩ faster · ⏪ slower — {from}',
  },
];

export const MAX_SHARE_CHARS = 480;

/** The template with the person's name and the sender's name filled in; missing names are left out neatly. */
export function fillTemplate(text: string, vars: { to?: string; from?: string }): string {
  const to = vars.to?.trim() ?? '';
  const from = vars.from?.trim() ?? '';
  return text
    .replace('{to}', to ? ` ${to}` : '')
    .replace(/\s*—\s*\{from\}/, from ? ` — ${from}` : '')
    .replace('{from}', from);
}

/**
 * What the voice actually says: the message without pictures and symbols (an emoji is not read aloud well), cut to
 * the length the speech service accepts.
 */
export function speakable(text: string): string {
  const clean = text
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/[·•]/g, ',')
    .replace(/\s*—\s*/g, '. ')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > MAX_SPEAK_CHARS ? clean.slice(0, MAX_SPEAK_CHARS).trimEnd() : clean;
}

/** What the person you asked can answer, and what it does to the voice. */
export interface Feedback {
  id: 'good' | 'higher' | 'lower' | 'faster' | 'slower' | 'different';
  emoji: string;
  label: string;
}

export const FEEDBACK: Feedback[] = [
  { id: 'good', emoji: '👍', label: 'Sounds like me' },
  { id: 'higher', emoji: '⏫', label: 'A bit higher' },
  { id: 'lower', emoji: '⏬', label: 'A bit lower' },
  { id: 'faster', emoji: '⏩', label: 'A bit faster' },
  { id: 'slower', emoji: '⏪', label: 'A bit slower' },
  { id: 'different', emoji: '🔁', label: 'Try another voice' },
];

const PITCH_STEP = 1.5;
const SPEED_STEP = 0.1;

/** The voice after one reply: a small, bounded change in pitch or pace. "Good" and "another voice" change nothing here. */
export function applyFeedback(profile: VoiceProfile, id: Feedback['id']): VoiceProfile {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  switch (id) {
    case 'higher':
      return { ...profile, pitch: clamp(profile.pitch + PITCH_STEP, MIN_PITCH, MAX_PITCH) };
    case 'lower':
      return { ...profile, pitch: clamp(profile.pitch - PITCH_STEP, MIN_PITCH, MAX_PITCH) };
    case 'faster':
      return { ...profile, speed: clamp(round2(profile.speed + SPEED_STEP), MIN_SPEED, MAX_SPEED) };
    case 'slower':
      return { ...profile, speed: clamp(round2(profile.speed - SPEED_STEP), MIN_SPEED, MAX_SPEED) };
    default:
      return profile;
  }
}
