import { z } from 'zod';
import { LANGUAGE_CODES } from './languages.js';
import { DEFAULT_PAUSE_MS, MAX_SPEED, MIN_SPEED } from './constants.js';
import { MAX_PITCH, MIN_PITCH } from './voiceProfile.js';
import { VOICE_IDS } from './voices.js';

/**
 * User settings (chrome.storage.sync). Each field falls back to its default on its own, so one corrupt
 * or out-of-range stored value never resets the others. Nothing here is video or transcript data.
 */
export const settingsSchema = z.object({
  voiceId: z.enum(VOICE_IDS).catch('aria'),
  speed: z.number().min(MIN_SPEED).max(MAX_SPEED).catch(1),
  /** Semitones the voice is raised or lowered (set by the voice setup). */
  pitch: z.number().min(MIN_PITCH).max(MAX_PITCH).catch(0),
  /** The voice setup questions have been answered (or skipped) once. */
  voiceSetupDone: z.boolean().catch(false),
  speakMode: z.enum(['auto', 'confirm']).catch('auto'),
  captionSize: z.enum(['small', 'medium', 'large']).catch('medium'),
  captionPosition: z.enum(['bottom', 'top']).catch('bottom'),
  /** Live translation: Ola's sentence is translated into this language (captioned and spoken). 'en' = off. */
  language: z.enum(LANGUAGE_CODES).catch('en'),
  postToChat: z.boolean().catch(false),
  /** Also play Ola's voice on this device's speakers, so the signer hears what the call hears. */
  monitorVoice: z.boolean().catch(true),
  /** Name confident signs on this device in milliseconds; the cloud model still checks them and corrects mistakes. */
  fastSigns: z.boolean().catch(true),
  /**
   * Also send each sign's clip to the cloud model (Gemini) to double-check the on-device answer. Off by default: the
   * on-device classifier decides on its own, with no cloud call and no waiting for one.
   */
  cloudCheck: z.boolean().catch(false),
  /**
   * Read Meet's live captions, have Gemini keep a short summary of the meeting, and use it to word sentences better.
   * Off by default: the captions are other people's words, so they are sent to Google Cloud only if this is turned on.
   */
  meetingContext: z.boolean().catch(false),
  theme: z.enum(['system', 'light', 'dark']).catch('system'),
  /** How long hands must rest before a sign clip ends. */
  holdTimeMs: z.number().int().min(200).max(1500).catch(400),
  /** Pause with no hands before the chips are composed into a sentence. */
  pauseMs: z.number().int().min(500).max(5000).catch(DEFAULT_PAUSE_MS),
  displayName: z.string().max(40).catch(''),
  /** Consent to send thumbs up/down plus sign labels (never video). */
  feedbackConsent: z.boolean().catch(false),
  onboardingDone: z.boolean().catch(false),
});

export type Settings = z.infer<typeof settingsSchema>;

export const SETTINGS_DEFAULTS: Settings = settingsSchema.parse({});

export function parseSettings(raw: unknown): Settings {
  return settingsSchema.parse(raw && typeof raw === 'object' ? raw : {});
}
